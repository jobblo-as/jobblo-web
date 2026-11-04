import mainLink from './mainURLs';

export const createSupportTicket = async (payload: {
  subject: string;
  message: string;
  email?: string;
}) => (await mainLink.post('/api/support/tickets', payload)).data;

/** "Rapporter en feil": multipart (message, pageUrl, platform, screen, errorRef?, screenshots[]). */
export const createBugReport = async (form: FormData) =>
  (
    await mainLink.post('/api/support/tickets', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  ).data;
