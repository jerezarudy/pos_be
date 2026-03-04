export type PaginationResult<T> = {
  data: T[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type PaginationParams = {
  page: number;
  limit: number;
  skip: number;
};

export function parsePagination(
  query: any,
  opts?: { defaultLimit?: number; maxLimit?: number },
): PaginationParams {
  const defaultLimit = opts?.defaultLimit ?? 20;
  const maxLimit = opts?.maxLimit ?? 100;

  const pageRaw = query?.page;
  const limitRaw = query?.limit;

  const pageNum = Number(pageRaw ?? 1);
  const limitNum = Number(limitRaw ?? defaultLimit);

  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.floor(pageNum) : 1;
  const limit =
    Number.isFinite(limitNum) && limitNum >= 1
      ? Math.min(Math.floor(limitNum), maxLimit)
      : defaultLimit;

  return { page, limit, skip: (page - 1) * limit };
}

