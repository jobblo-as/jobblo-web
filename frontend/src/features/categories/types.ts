export interface CategoryType {
  _id: string;
  name: string;
  icon: string;
  /** Set by an admin; the landing hero shows it before our stand-in photo. */
  image?: string;
  parentId?: string;
  slug?: string;
}
