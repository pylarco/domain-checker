
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ProcessedBaseNameResult, ProcessedTldResult, DomainStatus, DomainCheckOutcome } from './types';
import { domainCheckerService } from './services/domainCheckerService';
import { ResultsTable } from './components/ResultsTable';
import { Spinner } from './components/Spinner';

interface SortConfig {
  key: string; // 'baseName' or a TLD string
  direction: 'ascending' | 'descending';
}

interface FilterOptions {
  baseNameQuery: string;
  hasAvailable: boolean;
  noTaken: boolean;
  noInvalid: boolean;
  bestConsonant: boolean; 
}

interface PendingCellUpdate {
  baseName: string;
  tld: string;
  status: DomainStatus;
  reason?: string;
}

const statusOrder: Record<DomainStatus, number> = {
  [DomainStatus.AVAILABLE]: 0,
  [DomainStatus.CHECKING]: 1,
  [DomainStatus.IDLE]: 2,
  [DomainStatus.INVALID]: 3,
  [DomainStatus.TAKEN]: 4,
};

const BATCH_UPDATE_INTERVAL = 300; // milliseconds
const VOWELS = ['a', 'e', 'i', 'o', 'u'];
const COPY_FEEDBACK_TIMEOUT = 3000; // milliseconds

const App: React.FC = () => {
  const [baseNamesInput, setBaseNamesInput] = useState<string>('');
  const [tldsInput, setTldsInput] = useState<string>('');
  
  const [gridResults, setGridResults] = useState<ProcessedBaseNameResult[]>([]);
  const [parsedTldsForTable, setParsedTldsForTable] = useState<string[]>([]);
  
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const startTimeRef = useRef<number | null>(null);
  const [timeTaken, setTimeTaken] = useState<string | null>(null);

  const baseNamesInputRef = useRef<HTMLTextAreaElement>(null);
  const tldsInputRef = useRef<HTMLInputElement>(null);

  const [sortConfig, setSortConfig] = useState<SortConfig | null>(null);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({
    baseNameQuery: '',
    hasAvailable: false,
    noTaken: false,
    noInvalid: false,
    bestConsonant: false,
  });

  const pendingCellUpdatesRef = useRef<PendingCellUpdate[]>([]);
  const flushIntervalRef = useRef<number | null>(null);
  const completedChecksRef = useRef<number>(0);
  const totalChecksRef = useRef<number>(0);
  const [copyStatusMessage, setCopyStatusMessage] = useState<string | null>(null);
  const copyMessageTimeoutRef = useRef<number | null>(null);


  const generateUniqueId = useCallback((): string => {
    return `cell-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }, []);

  const flushPendingCellUpdates = useCallback(() => {
    if (pendingCellUpdatesRef.current.length === 0) {
      return;
    }

    const updatesToApply = [...pendingCellUpdatesRef.current];
    pendingCellUpdatesRef.current = [];

    setGridResults(prevResults => {
      const updatesByBaseName: Record<string, Record<string, { status: DomainStatus; reason?: string }>> = {};
      updatesToApply.forEach(update => {
        if (!updatesByBaseName[update.baseName]) {
          updatesByBaseName[update.baseName] = {};
        }
        updatesByBaseName[update.baseName][update.tld] = { status: update.status, reason: update.reason };
      });

      return prevResults.map(row => {
        const rowUpdates = updatesByBaseName[row.baseName];
        if (!rowUpdates) {
          return row;
        }
        let hasChanged = false;
        const newTldResults = row.tldResults.map(cell => {
          const cellUpdate = rowUpdates[cell.tld];
          if (cellUpdate) {
            hasChanged = true;
            return { ...cell, status: cellUpdate.status, reason: cellUpdate.reason };
          }
          return cell;
        });
        return hasChanged ? { ...row, tldResults: newTldResults } : row;
      });
    });
  }, []);


  const clearAsyncOperations = useCallback(() => {
    if (flushIntervalRef.current) {
      clearInterval(flushIntervalRef.current);
      flushIntervalRef.current = null;
    }
    pendingCellUpdatesRef.current = [];
    completedChecksRef.current = 0;
    totalChecksRef.current = 0;
  }, []);

  const handleClear = useCallback(() => {
    setBaseNamesInput('');
    setTldsInput('');
    setGridResults([]);
    setParsedTldsForTable([]);
    setIsLoading(false);
    setSummary(null);
    setErrorMessage(null);
    setTimeTaken(null);
    startTimeRef.current = null;
    setSortConfig(null);
    setFilterOptions({ baseNameQuery: '', hasAvailable: false, noTaken: false, noInvalid: false, bestConsonant: false });
    setCopyStatusMessage(null);
    if (copyMessageTimeoutRef.current) clearTimeout(copyMessageTimeoutRef.current);
    clearAsyncOperations();
    baseNamesInputRef.current?.focus();
  }, [clearAsyncOperations]);
  
  const handleClearFilters = useCallback(() => {
    setFilterOptions({ baseNameQuery: '', hasAvailable: false, noTaken: false, noInvalid: false, bestConsonant: false });
    setSortConfig(null); // Optionally reset sort when clearing filters
  }, []);

  const isValidBaseName = (name: string): boolean => {
    if (name.includes('.')) return false;
    if (name.startsWith('-') || name.endsWith('-')) return false;
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name);
  };

  const isValidTld = (tld: string): boolean => {
    if (tld.startsWith('.') || tld.endsWith('.')) return false;
    if (tld.includes('..')) return false;
    if (tld.length < 2) return false;
    // TLDs can contain hyphens, but not start/end with them, and cannot be all numeric (last part).
    return /^[a-z0-9](?:[a-z0-9.-]{0,61}[a-z0-9])?$/i.test(tld) && !/^[0-9]+$/.test(tld.split('.').pop() || "");
  };

  const handleSubmit = useCallback(async () => {
    setErrorMessage(null);
    setGridResults([]); 
    setParsedTldsForTable([]);
    setTimeTaken(null);
    startTimeRef.current = null;
    setSortConfig(null);
    setCopyStatusMessage(null);
    if (copyMessageTimeoutRef.current) clearTimeout(copyMessageTimeoutRef.current);
    clearAsyncOperations();
    
    // Normalize delimiters: replace commas and spaces (and their sequences) with newlines
    const normalizedInput = baseNamesInput.replace(/[, \t]+/g, '\n');

    const uniqueBaseNames = normalizedInput
      .split('\n')
      .map(d => d.trim().toLowerCase())
      .filter(d => d.length > 0)
      .filter((value, index, self) => self.indexOf(value) === index);

    const uniqueTlds = tldsInput
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(t => t.length > 0)
      .filter((value, index, self) => self.indexOf(value) === index);

    if (uniqueBaseNames.length === 0) {
      setErrorMessage('Please enter at least one base name.');
      return;
    }
    if (uniqueTlds.length === 0) {
      setErrorMessage('Please enter at least one TLD.');
      return;
    }

    const invalidBaseNames = uniqueBaseNames.filter(name => !isValidBaseName(name));
    if (invalidBaseNames.length > 0) {
      setErrorMessage(`Invalid base name(s): ${invalidBaseNames.join(', ')}. Base names cannot contain dots and must be valid DNS labels.`);
      return;
    }

    const invalidTlds = uniqueTlds.filter(tld => !isValidTld(tld));
    if (invalidTlds.length > 0) {
      setErrorMessage(`Invalid TLD(s): ${invalidTlds.join(', ')}. TLDs must be valid (e.g., com, co.uk).`);
      return;
    }
    
    setIsLoading(true);
    setParsedTldsForTable(uniqueTlds);
    startTimeRef.current = Date.now();

    const initialGridResults: ProcessedBaseNameResult[] = uniqueBaseNames.map(base => ({
      baseName: base,
      tldResults: uniqueTlds.map(tld => ({
        tld: tld,
        status: DomainStatus.CHECKING,
        id: generateUniqueId(),
        reason: undefined,
      })),
    }));
    setGridResults(initialGridResults); 

    const domainsToProcess: { baseName: string, tld: string, fullDomain: string }[] = [];
    uniqueBaseNames.forEach(base => {
      uniqueTlds.forEach(tld => {
        domainsToProcess.push({ baseName: base, tld: tld, fullDomain: `${base}.${tld}` });
      });
    });
    
    totalChecksRef.current = domainsToProcess.length;
    completedChecksRef.current = 0;

    if (totalChecksRef.current > 50000) {
        setErrorMessage('Generated more than 50,000 domain combinations. Please reduce base names or TLDs.');
        setIsLoading(false);
        setGridResults([]); 
        setParsedTldsForTable([]);
        startTimeRef.current = null;
        clearAsyncOperations();
        return;
    }
    if (totalChecksRef.current === 0) {
        setErrorMessage('No valid domain combinations to check.');
        setIsLoading(false);
        startTimeRef.current = null;
        clearAsyncOperations();
        return;
    }

    flushIntervalRef.current = window.setInterval(flushPendingCellUpdates, BATCH_UPDATE_INTERVAL);

    domainsToProcess.forEach(item => {
      domainCheckerService.checkDomain(item.fullDomain)
        .then(checkOutcome => {
          pendingCellUpdatesRef.current.push({
            baseName: item.baseName,
            tld: item.tld,
            status: checkOutcome.status,
            reason: checkOutcome.reason
          });
        })
        .catch(error => { 
          console.error(`Error processing check for ${item.fullDomain}:`, error);
          pendingCellUpdatesRef.current.push({
            baseName: item.baseName,
            tld: item.tld,
            status: DomainStatus.INVALID,
            reason: 'Error during check'
          });
        })
        .finally(() => {
          completedChecksRef.current++;
          if (completedChecksRef.current === totalChecksRef.current) {
            if (flushIntervalRef.current) {
              clearInterval(flushIntervalRef.current);
              flushIntervalRef.current = null;
            }
            flushPendingCellUpdates(); 
            setIsLoading(false);
            if (startTimeRef.current) {
              const duration = (Date.now() - startTimeRef.current) / 1000;
              setTimeTaken(`${duration.toFixed(2)} seconds`);
            }
          }
        });
    });
  }, [baseNamesInput, tldsInput, generateUniqueId, flushPendingCellUpdates, clearAsyncOperations]);
  
  const isVowel = (char: string): boolean => VOWELS.includes(char.toLowerCase());

  const startsWithConsonant = (name: string): boolean => {
    if (!name || name.length === 0) return false;
    const firstChar = name[0].toLowerCase();
    return /^[a-z]$/.test(firstChar) && !isVowel(firstChar);
  };

  const hasVowel = (name: string): boolean => {
    for (let i = 0; i < name.length; i++) {
      if (isVowel(name[i])) return true;
    }
    return false;
  };
  
  const filteredResults = useMemo(() => {
    let results = [...gridResults];
    if (filterOptions.baseNameQuery) {
      results = results.filter(row => 
        row.baseName.toLowerCase().includes(filterOptions.baseNameQuery.toLowerCase())
      );
    }
    if (filterOptions.hasAvailable) {
      results = results.filter(row => 
        row.tldResults.some(cell => cell.status === DomainStatus.AVAILABLE)
      );
    }
    if (filterOptions.noTaken) {
      results = results.filter(row => 
        !row.tldResults.some(cell => cell.status === DomainStatus.TAKEN)
      );
    }
    if (filterOptions.noInvalid) {
      results = results.filter(row => 
        !row.tldResults.some(cell => cell.status === DomainStatus.INVALID)
      );
    }
    if (filterOptions.bestConsonant) {
      results = results.filter(row => {
        const name = row.baseName;
        const startsWithC = startsWithConsonant(name);
        // If name is 1 char long, startsWithC is enough. Otherwise, must also have a vowel.
        const containsVowel = name.length > 1 ? hasVowel(name) : true; 
        return startsWithC && containsVowel;
      });
    }
    return results;
  }, [gridResults, filterOptions]);

  const handleSortRequest = (key: string) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const sortedAndFilteredResults = useMemo(() => {
    let sortableItems = [...filteredResults];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        if (sortConfig.key === 'baseName') {
          return a.baseName.localeCompare(b.baseName);
        } else {
          const aTldResult = a.tldResults.find(r => r.tld === sortConfig.key);
          const bTldResult = b.tldResults.find(r => r.tld === sortConfig.key);
          const aStatus = aTldResult ? statusOrder[aTldResult.status] : Infinity;
          const bStatus = bTldResult ? statusOrder[bTldResult.status] : Infinity;
          return aStatus - bStatus;
        }
      });
      if (sortConfig.direction === 'descending') {
        sortableItems.reverse();
      }
    }
    return sortableItems;
  }, [filteredResults, sortConfig]);

  useEffect(() => {
    if (gridResults.length === 0 && !isLoading) {
      setSummary(null);
      return;
    }

    let availableCount = 0;
    let takenCount = 0;
    let invalidCount = 0;
    let checkingStill = 0; 
    
    gridResults.forEach(row => {
      row.tldResults.forEach(cell => {
        switch (cell.status) {
          case DomainStatus.AVAILABLE: availableCount++; break;
          case DomainStatus.TAKEN: takenCount++; break;
          case DomainStatus.INVALID: invalidCount++; break;
          case DomainStatus.CHECKING: checkingStill++; break;
          case DomainStatus.IDLE: break; // IDLE doesn't count towards processed/stats
        }
      });
    });
    
    const currentTotalChecks = totalChecksRef.current > 0 ? totalChecksRef.current : (parsedTldsForTable.length * gridResults.length);

    if (isLoading && currentTotalChecks > 0) {
        const trulyCompleted = currentTotalChecks - checkingStill; 
        const percentage = currentTotalChecks > 0 ? (trulyCompleted / currentTotalChecks * 100).toFixed(0) : 0;
        setSummary(`Checking ${currentTotalChecks} domains... (${percentage}% processed, ${checkingStill} pending updates)`);
    } else if (currentTotalChecks > 0 && !isLoading) { 
      let summaryText = `${currentTotalChecks} domains processed: ${availableCount} Available, ${takenCount} Taken, ${invalidCount} Invalid.`;
      if (timeTaken) {
        summaryText += ` Time taken: ${timeTaken}.`;
      }
      setSummary(summaryText);
    } else {
       setSummary(null);
    }
  }, [gridResults, isLoading, timeTaken, parsedTldsForTable]); 
  
  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFilterOptions(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const isAnyFilterActive = useMemo(() => {
    return filterOptions.baseNameQuery !== '' || 
           filterOptions.hasAvailable ||
           filterOptions.noTaken ||
           filterOptions.noInvalid ||
           filterOptions.bestConsonant;
  }, [filterOptions]);

  const handleCopyFilteredBaseNames = async () => {
    if (copyMessageTimeoutRef.current) {
      clearTimeout(copyMessageTimeoutRef.current);
    }
    if (sortedAndFilteredResults.length === 0) {
      setCopyStatusMessage("No base names to copy.");
      copyMessageTimeoutRef.current = window.setTimeout(() => setCopyStatusMessage(null), COPY_FEEDBACK_TIMEOUT);
      return;
    }
    const baseNamesToCopy = sortedAndFilteredResults.map(r => r.baseName).join('\n');
    try {
      await navigator.clipboard.writeText(baseNamesToCopy);
      setCopyStatusMessage(`Copied ${sortedAndFilteredResults.length} base name(s) to clipboard!`);
    } catch (err) {
      console.error('Failed to copy base names:', err);
      setCopyStatusMessage('Failed to copy. See console for details.');
    }
    copyMessageTimeoutRef.current = window.setTimeout(() => setCopyStatusMessage(null), COPY_FEEDBACK_TIMEOUT);
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyMessageTimeoutRef.current) {
        clearTimeout(copyMessageTimeoutRef.current);
      }
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
      }
    };
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col items-center p-4 sm:p-8 selection:bg-sky-500 selection:text-white">
      <header className="mb-8 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold text-sky-400">Domain & TLD Availability Checker</h1>
        <p className="text-slate-400 mt-2 text-sm sm:text-base">
          Enter base names (e.g., "mydomain") and TLDs (e.g., "com, net") to check all combinations.
        </p>
      </header>

      <main className="w-full max-w-7xl bg-slate-800 shadow-2xl rounded-lg p-6 sm:p-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          <div>
            <label htmlFor="baseNames" className="block text-sm font-medium text-slate-300 mb-1">
              Base Names (separated by line, space, or comma)
            </label>
            <textarea
              id="baseNames"
              ref={baseNamesInputRef}
              rows={5}
              className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400 resize-y"
              placeholder="example name2, another-name&#x0a;myproduct"
              value={baseNamesInput}
              onChange={(e) => setBaseNamesInput(e.target.value)}
              disabled={isLoading}
              aria-label="Base Domain Names Input Area"
            />
          </div>
          <div>
            <label htmlFor="tlds" className="block text-sm font-medium text-slate-300 mb-1">
              TLDs (comma-separated)
            </label>
            <input
              type="text"
              id="tlds"
              ref={tldsInputRef}
              className="w-full p-3 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
              placeholder="com, net, org, ai, co.uk"
              value={tldsInput}
              onChange={(e) => setTldsInput(e.target.value)}
              disabled={isLoading}
              aria-label="Top-Level Domains (TLDs) Input Area"
            />
          </div>
        </div>

        {errorMessage && (
          <div role="alert" className="mb-4 p-3 bg-red-700/50 border border-red-600 text-red-200 rounded-md text-sm">
            {errorMessage}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <button
            onClick={handleSubmit}
            disabled={isLoading || !baseNamesInput.trim() || !tldsInput.trim()}
            className="w-full sm:w-auto flex-grow justify-center items-center px-6 py-3 bg-sky-600 text-white font-semibold rounded-md shadow-md hover:bg-sky-500 disabled:bg-slate-500 disabled:cursor-not-allowed transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Check domain availability"
          >
            {isLoading ? (
              <>
                <Spinner size="sm" color="text-white" />
                <span className="ml-2">Checking...</span>
              </>
            ) : (
              'Check Availability'
            )}
          </button>
          <button
            onClick={handleClear}
            disabled={isLoading && baseNamesInput.length === 0 && tldsInput.length === 0}
            className="w-full sm:w-auto px-6 py-3 bg-slate-600 text-white font-semibold rounded-md shadow-md hover:bg-slate-500 disabled:bg-slate-400 disabled:cursor-not-allowed transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 focus:ring-offset-slate-800"
            aria-label="Clear inputs and results"
          >
            Clear All
          </button>
        </div>

        {gridResults.length > 0 && !isLoading && (
          <div className="mb-6 p-4 bg-slate-700/50 rounded-lg">
            <h3 className="text-lg font-semibold text-slate-200 mb-3">Filter Results</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <div>
                <label htmlFor="baseNameQuery" className="block text-sm font-medium text-slate-300 mb-1">
                  Filter by Base Name
                </label>
                <input
                  type="text"
                  id="baseNameQuery"
                  name="baseNameQuery"
                  className="w-full p-2 bg-slate-700 border border-slate-600 rounded-md shadow-sm focus:ring-sky-500 focus:border-sky-500 text-slate-100 placeholder-slate-400"
                  placeholder="Enter base name..."
                  value={filterOptions.baseNameQuery}
                  onChange={handleFilterChange}
                />
              </div>
              <div className="col-span-1 sm:col-span-2 lg:col-span-2 flex flex-wrap items-center gap-x-6 gap-y-3 pt-2 sm:pt-6">
                <label className="flex items-center space-x-2 cursor-pointer text-sm text-slate-300 hover:text-sky-300">
                  <input
                    type="checkbox"
                    name="hasAvailable"
                    checked={filterOptions.hasAvailable}
                    onChange={handleFilterChange}
                    className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                  />
                  <span>Has 'Available'</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-sm text-slate-300 hover:text-sky-300">
                  <input
                    type="checkbox"
                    name="noTaken"
                    checked={filterOptions.noTaken}
                    onChange={handleFilterChange}
                    className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                  />
                  <span>Has no 'Taken'</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-sm text-slate-300 hover:text-sky-300">
                  <input
                    type="checkbox"
                    name="noInvalid"
                    checked={filterOptions.noInvalid}
                    onChange={handleFilterChange}
                    className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                  />
                  <span>Has no 'Invalid'</span>
                </label>
                <label className="flex items-center space-x-2 cursor-pointer text-sm text-slate-300 hover:text-sky-300">
                  <input
                    type="checkbox"
                    name="bestConsonant"
                    checked={filterOptions.bestConsonant}
                    onChange={handleFilterChange}
                    className="form-checkbox h-4 w-4 text-sky-600 bg-slate-600 border-slate-500 rounded focus:ring-sky-500"
                  />
                  <span>Best Consonant</span>
                </label>
                 {isAnyFilterActive && (
                    <button
                        onClick={handleClearFilters}
                        className="text-xs text-sky-400 hover:text-sky-300 underline"
                        aria-label="Clear all active filters"
                    >
                        Clear Filters
                    </button>
                 )}
              </div>
            </div>
            <div className="mt-4 flex items-center gap-4">
                 <button
                    onClick={handleCopyFilteredBaseNames}
                    disabled={sortedAndFilteredResults.length === 0}
                    className="px-4 py-2 bg-emerald-600 text-white text-sm font-semibold rounded-md shadow-md hover:bg-emerald-500 disabled:bg-slate-500 disabled:cursor-not-allowed transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-800"
                    aria-label="Copy filtered base names to clipboard"
                 >
                    Copy Filtered Base Names ({sortedAndFilteredResults.length})
                 </button>
                 {copyStatusMessage && (
                    <span className={`text-sm ${copyStatusMessage.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`} aria-live="assertive">
                        {copyStatusMessage}
                    </span>
                 )}
            </div>
          </div>
        )}

        {(summary && (isLoading || gridResults.length > 0)) && (
          <div className="mb-6 p-3 bg-slate-700 rounded-md text-slate-300 text-sm text-center" aria-live="polite">
            {summary}
          </div>
        )}

        {gridResults.length > 0 && sortedAndFilteredResults.length > 0 && (
            <ResultsTable 
                results={sortedAndFilteredResults} 
                tlds={parsedTldsForTable}
                sortConfig={sortConfig}
                onSortRequest={handleSortRequest}
            />
        )}
        
        {gridResults.length > 0 && !isLoading && sortedAndFilteredResults.length === 0 && (
             <div className="mt-6 p-4 bg-slate-700/30 rounded-md text-center text-slate-400">
                <p>No results match your current filters.</p>
             </div>
        )}

        {!isLoading && gridResults.length === 0 && (baseNamesInput.trim() !== '' || tldsInput.trim() !== '') && !errorMessage && (
             <div className="mt-6 text-center text-slate-400">
                <p>Enter base names and TLDs, then click "Check Availability" to see results.</p>
             </div>
        )}
      </main>
      <footer className="mt-12 text-center text-sm text-slate-500">
        <p>&copy; {new Date().getFullYear()} Domain Availability Checker. Uses public DNS for checks.</p>
      </footer>
    </div>
  );
};

export default App;
