export interface CER {
  code: string;
  description: string;
  category: string;
  isPericoloso: boolean;
  note?: string;
}

export interface PaginatedCERResponse {
  items: CER[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CERSearchResult {
  code: string;
  description: string;
  isPericoloso: boolean;
}
