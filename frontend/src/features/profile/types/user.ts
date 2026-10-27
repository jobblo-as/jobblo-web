// Settings sends only the changed fields, and skills/locations are string arrays.
export type UserUpdatePayload = FormData | Record<string, unknown>;

export type ExperiencePayload = {
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  description: string;
};
