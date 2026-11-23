export interface AlertType {
  _id: string;
  userId: {
    _id: string;
    name: string;
    email: string;
  } | null;
  senderId?: {
    _id: string;
    name: string;
    lastName?: string;
    avatarUrl?: string;
  } | null;
  type: string;
  content: string;
  orderId?:
    | string
    | {
        _id: string;
        status: string;
        customerId?: string;
        providerId?: string;
        paymentStatus?: string;
      };
  requestId?: string | { _id: string; status: string };
  /** The job, for notifications about a job itself (e.g. the "add photos" reminder). */
  serviceId?: string | null;
  read: boolean;
  createdAt: string;
  updatedAt: string;
}
