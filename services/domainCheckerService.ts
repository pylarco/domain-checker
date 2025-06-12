
import { DomainStatus, DomainCheckOutcome } from '../types';

// isValidDomainFormat remains the same as it's robust for format validation.
const isValidDomainFormat = (domain: string): { valid: boolean; reason?: string } => {
  if (!domain || typeof domain !== 'string') {
    return { valid: false, reason: "Domain must be a string." };
  }
  const normalizedDomain = domain.toLowerCase().trim();

  if (normalizedDomain.length < 3 || normalizedDomain.length > 253) {
    return { valid: false, reason: "Domain length must be between 3 and 253 characters." };
  }
  if (!normalizedDomain.includes('.') || normalizedDomain.startsWith('.') || normalizedDomain.endsWith('.')) {
    return { valid: false, reason: "Domain must contain at least one dot, not at the start or end." };
  }
  if (/[^a-z0-9.-]/i.test(normalizedDomain)) {
    return { valid: false, reason: "Domain contains invalid characters. Only alphanumeric, dots, and hyphens allowed." };
  }
  if (normalizedDomain.includes('..')) {
    return { valid: false, reason: "Domain cannot contain consecutive dots." };
  }

  const labels = normalizedDomain.split('.');
  if (labels.some(label => label.length === 0 || label.length > 63)) {
    return { valid: false, reason: "Each part of the domain (label) must be between 1 and 63 characters." };
  }
  if (labels.some(label => label.startsWith('-') || label.endsWith('-'))) {
    return { valid: false, reason: "Labels cannot start or end with a hyphen." };
  }
  const tld = labels[labels.length -1];
  if (/^[0-9]+$/.test(tld) && tld.length > 0) {
     return { valid: false, reason: "Top-level domain (TLD) appears invalid (e.g., all numeric)." };
  }
   if (tld.length < 2) {
    return { valid: false, reason: "Top-level domain (TLD) must be at least 2 characters long." };
  }

  return { valid: true };
};

interface DohProvider {
  name: string;
  urlPattern: (domain: string, recordType: 'A' | 'NS') => string;
}

interface DohQueryResult {
  providerName: string;
  recordType: 'A' | 'NS';
  dnsStatus?: number; // DNS RCODE (0 for NOERROR, 3 for NXDOMAIN, etc.)
  data?: any;
  error?: string; // Network or parsing error message
}

class DomainCheckerService {
  private providers: DohProvider[] = [
    {
      name: 'Cloudflare',
      urlPattern: (domain, recordType) => `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${recordType}`,
    },
    {
      name: 'Google',
      urlPattern: (domain, recordType) => `https://dns.google/resolve?name=${encodeURIComponent(domain)}&type=${recordType}`,
    },
  ];

  private async makeDohQuery(provider: DohProvider, domain: string, recordType: 'A' | 'NS'): Promise<DohQueryResult> {
    const url = provider.urlPattern(domain, recordType);
    try {
      const response = await fetch(url, {
        headers: { 'accept': 'application/dns-json' },
        cache: 'no-store',
      });
      const responseData = await response.json();
      
      if (!response.ok) {
        return { 
          providerName: provider.name,
          recordType,
          error: `HTTP error ${response.status} ${response.statusText}`, 
          dnsStatus: responseData?.Status 
        };
      }
      // Both Cloudflare and Google use 'Status' for the DNS RCODE in their JSON response.
      return { 
        providerName: provider.name,
        recordType,
        dnsStatus: responseData.Status, 
        data: responseData 
      };
    } catch (err) {
      let message = `Network/JSON error`;
      if (err instanceof Error) message = err.message;
      return { 
        providerName: provider.name,
        recordType,
        error: message 
      };
    }
  }

  public async checkDomain(domain: string): Promise<DomainCheckOutcome> {
    const validation = isValidDomainFormat(domain);
    if (!validation.valid) {
      return { status: DomainStatus.INVALID, reason: validation.reason! };
    }

    const queryPromises: Promise<DohQueryResult>[] = [];
    this.providers.forEach(provider => {
      queryPromises.push(this.makeDohQuery(provider, domain, 'A'));
      queryPromises.push(this.makeDohQuery(provider, domain, 'NS'));
    });

    const results = await Promise.all(queryPromises);

    const takenReasons: string[] = [];
    let allQueriesReportNxDomain = true;
    const allQueryDetails: string[] = [];

    results.forEach(res => {
      const detailPrefix = `${res.providerName} ${res.recordType}-query`;
      if (res.dnsStatus === 0) { // NOERROR
        takenReasons.push(`${detailPrefix}: NOERROR${((res.data?.Answer?.length ?? 0) > 0) ? ' (has records)' : ' (no specific records, e.g., parked)'}`);
        allQueriesReportNxDomain = false; // If one says NOERROR, it can't be all NXDOMAIN
      } else if (res.dnsStatus === 3) { // NXDOMAIN
        allQueryDetails.push(`${detailPrefix}: NXDOMAIN`);
        // This query reported NXDOMAIN, keep allQueriesReportNxDomain as true (unless another query falsifies it)
      } else { // Error or other status
        allQueriesReportNxDomain = false; // If any query is not NXDOMAIN (and not NOERROR covered above), it's not "all NXDOMAIN"
        allQueryDetails.push(`${detailPrefix}: ${res.error ? `Error (${res.error})` : `Status ${res.dnsStatus === undefined ? 'Unknown' : res.dnsStatus}`}`);
      }
    });

    if (takenReasons.length > 0) {
      return { status: DomainStatus.TAKEN, reason: `Taken because: ${takenReasons.join('; ')}. Other details: ${allQueryDetails.filter(d => !takenReasons.some(tr => d.startsWith(tr.substring(0, tr.indexOf(':'))))).join('; ')}` };
    }

    if (allQueriesReportNxDomain) {
      // This implies no takenReasons were found (no NOERROR), and all results were dnsStatus 3.
      return { status: DomainStatus.AVAILABLE, reason: `All providers reported NXDOMAIN for A & NS records. Details: ${allQueryDetails.join('; ')}` };
    }

    // If not definitively taken by NOERROR, and not all NXDOMAIN, then it's ambiguous or has errors. Default to TAKEN.
    return { status: DomainStatus.TAKEN, reason: `Availability ambiguous, assuming taken. Details: ${allQueryDetails.join('; ')}` };
  }
}

export const domainCheckerService = new DomainCheckerService();
