
import React from 'react';
import { ProcessedBaseNameResult, DomainStatus } from '../types';
import { StatusDisplay } from './StatusDisplay';

interface SortConfig {
  key: string;
  direction: 'ascending' | 'descending';
}

interface ResultsTableProps {
  results: ProcessedBaseNameResult[];
  tlds: string[]; // Parsed TLDs for header columns
  sortConfig: SortConfig | null;
  onSortRequest: (key: string) => void;
}

const getSortIndicator = (columnKey: string, sortConfig: SortConfig | null): string => {
  if (!sortConfig || sortConfig.key !== columnKey) {
    return ''; // Or a neutral icon like '↕'
  }
  return sortConfig.direction === 'ascending' ? ' ▲' : ' ▼';
};

export const ResultsTable: React.FC<ResultsTableProps> = ({ results, tlds, sortConfig, onSortRequest }) => {
  if (results.length === 0 || tlds.length === 0) {
    // This case should ideally be handled by the parent (App.tsx)
    // to show "No results match filters" or similar
    return null;
  }

  return (
    <div className="overflow-x-auto bg-slate-800 rounded-lg shadow ring-1 ring-slate-700">
      <table className="min-w-full divide-y divide-slate-700 table-fixed sm:table-auto"> {/* table-fixed helps with sticky header width issue in some cases */}
        <thead className="bg-slate-700/50 sticky top-0 z-10">
          <tr>
            <th
              scope="col"
              className="w-1/4 sm:w-auto px-4 py-3 text-left text-xs font-medium text-slate-300 uppercase tracking-wider sticky left-0 bg-slate-700/50 z-20 cursor-pointer hover:bg-slate-600/50 transition-colors"
              onClick={() => onSortRequest('baseName')}
              aria-sort={sortConfig?.key === 'baseName' ? (sortConfig.direction === 'ascending' ? 'ascending' : 'descending') : 'none'}
            >
              Base Name
              <span className="ml-1 text-sky-400">{getSortIndicator('baseName', sortConfig)}</span>
            </th>
            {tlds.map((tld) => (
              <th
                key={tld}
                scope="col"
                className="w-1/6 sm:w-auto px-4 py-3 text-center text-xs font-medium text-slate-300 uppercase tracking-wider cursor-pointer hover:bg-slate-600/50 transition-colors"
                onClick={() => onSortRequest(tld)}
                aria-sort={sortConfig?.key === tld ? (sortConfig.direction === 'ascending' ? 'ascending' : 'descending') : 'none'}
              >
                {tld}
                <span className="ml-1 text-sky-400">{getSortIndicator(tld, sortConfig)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {results.map((baseNameResult) => (
            <tr key={baseNameResult.baseName} className="hover:bg-slate-700/30 transition-colors duration-150 group">
              <td 
                scope="row"
                className="w-1/4 sm:w-auto px-4 py-3 whitespace-normal break-words text-sm font-medium text-sky-300 sticky left-0 bg-slate-800 group-hover:bg-slate-700/40 z-10 transition-colors"
              >
                {baseNameResult.baseName}
              </td>
              {tlds.map((headerTld) => {
                const cellResult = baseNameResult.tldResults.find(r => r.tld === headerTld);
                if (!cellResult) {
                  return <td key={headerTld} className="w-1/6 sm:w-auto px-4 py-3 whitespace-nowrap text-sm text-center text-slate-500">-</td>;
                }
                return (
                  <td key={cellResult.id} className="w-1/6 sm:w-auto px-4 py-3 whitespace-nowrap text-sm text-center">
                    <StatusDisplay status={cellResult.status} reason={cellResult.reason} />
                    {cellResult.status === DomainStatus.INVALID && cellResult.reason && (
                      <div 
                        className="text-xs text-orange-400/80 mt-1 truncate" 
                        title={cellResult.reason}
                        style={{ maxWidth: '120px', margin: 'auto' }} 
                      >
                        {cellResult.reason}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
