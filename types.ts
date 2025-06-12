export enum DomainStatus {
  CHECKING = 'Checking',
  AVAILABLE = 'Available',
  TAKEN = 'Taken',
  INVALID = 'Invalid',
  IDLE = 'Idle',
}

// Represents the result for a single TLD combination with a base name
export interface ProcessedTldResult {
  tld: string;
  status: DomainStatus;
  reason?: string;
  id: string; // Unique ID for this specific baseName.tld check
}

// Represents a base name and all its TLD check results
export interface ProcessedBaseNameResult {
  baseName: string;
  tldResults: ProcessedTldResult[]; // One entry for each TLD checked against this base name
}


// Original interface, will be less central for App state
export interface DomainCheckResult {
  id: string;
  domain: string; // Full domain name (base.tld)
  status: DomainStatus;
  reason?: string;
}

// Used by the service to return the outcome of a domain check
export interface DomainCheckOutcome {
  status: DomainStatus;
  reason?: string;
}