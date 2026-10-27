import type { Jobs } from '../../types/Jobs';

/** A list owner or contributor as `getListById` populates them. */
export interface ListMember {
  _id: string;
  name?: string;
  lastName?: string;
  email?: string;
  avatarUrl?: string;
}

/** backend/models/List.js. `services` is populated by both list endpoints; `user` and
 * `contributors` only by getListById, the one page that reads them. */
export interface FavoriteList {
  _id: string;
  name: string;
  description?: string;
  user: ListMember[];
  public?: boolean;
  services: Jobs[];
  contributors?: ListMember[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateListDTO {
  name: string;
}

export interface UpdateListDTO {
  name?: string;
  description?: string;
  public?: boolean;
}

export interface AddServiceToListDTO {
  listId: string;
  serviceId: string;
}
