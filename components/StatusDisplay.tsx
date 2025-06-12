
import React from 'react';
import { DomainStatus } from '../types';
import { Spinner } from './Spinner';

interface StatusDisplayProps {
  status: DomainStatus;
  reason?: string;
}

const getStatusBadgeClasses = (status: DomainStatus): string => {
  const baseClasses = "px-3 py-1 text-xs font-semibold rounded-full inline-flex items-center leading-tight";
  switch (status) {
    case DomainStatus.AVAILABLE:
      return `${baseClasses} bg-green-700/30 text-green-300 border border-green-600`;
    case DomainStatus.TAKEN:
      return `${baseClasses} bg-red-700/30 text-red-300 border border-red-600`;
    case DomainStatus.INVALID:
      return `${baseClasses} bg-orange-700/30 text-orange-300 border border-orange-600`;
    case DomainStatus.CHECKING:
      return `${baseClasses} bg-yellow-700/30 text-yellow-300 border border-yellow-600`;
    default:
      return `${baseClasses} bg-slate-700/30 text-slate-300 border border-slate-600`;
  }
};


export const StatusDisplay: React.FC<StatusDisplayProps> = ({ status, reason }) => {
  const badgeClasses = getStatusBadgeClasses(status);

  if (status === DomainStatus.CHECKING) {
    return (
      <span className={badgeClasses}>
        <Spinner size="xs" color="text-yellow-300" className="mr-2" />
        Checking...
      </span>
    );
  }
  
  // The 'title' attribute of the span element, as per the type error,
  // expects one of the DomainStatus enum string values (excluding 'Checking', which is handled above).
  // Using 'status' directly ensures compliance.
  // The original attempt to include 'reason' in the title for INVALID status: `Invalid: ${reason}`
  // caused a type conflict because that string is not one of the literal enum values.
  // The 'reason' is still available as a prop and displayed in the ResultsTable.
  return <span className={badgeClasses} title={status}>{status}</span>;
};
