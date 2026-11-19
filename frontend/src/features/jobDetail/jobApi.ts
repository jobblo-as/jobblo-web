import mainLink from '../../api/mainURLs';
import type { Jobs } from '../../types/Jobs';

export const getJobDetail = async (id: string) => {
  const response = await mainLink.get(`/api/services/${id}`);
  return response.data;
};

/** "Lignende oppdrag": same category, the most alike title first; paged (12 a page). */
export const getSimilarJobs = async (
  id: string,
  page = 1,
  limit = 12
): Promise<{ data: Jobs[]; pagination: { page: number; totalPages: number; total: number } }> => {
  const { data } = await mainLink.get(`/api/services/${id}/similar`, { params: { page, limit } });
  const jobs: Jobs[] = Array.isArray(data?.data) ? data.data : [];
  return {
    data: jobs,
    pagination: data?.pagination ?? { page, totalPages: 1, total: jobs.length },
  };
};

export const createChat = async (payload: { providerId: string; serviceId: string }) => {
  const { data } = await mainLink.post('/api/chats/create', payload);
  return data;
};

// 4. Stripe Payment API (402 error handling ke liye)
export const createStripeSession = async (payload: {
  amount?: number;
  providerId?: string;
  serviceId: string;
}): Promise<{ url: string }> => {
  const { data } = await mainLink.post('/api/stripe/create-extra-contact-payment', payload);
  return data;
};
