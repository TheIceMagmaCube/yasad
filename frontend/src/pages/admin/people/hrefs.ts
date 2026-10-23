/** Address of the people table. */
export const LIST = "/admin/users";
export const personHref = (id: string) => `${LIST}/${encodeURIComponent(id)}`;
/** Address of the read-only preview of a person's home page. */
export const previewHref = (id: string) => `${personHref(id)}/home`;
export const groupHref = (id: string) => `/admin/groups/${encodeURIComponent(id)}`;
