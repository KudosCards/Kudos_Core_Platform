/** Shared response envelope for every paginated list endpoint. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  perPage: number;
}
