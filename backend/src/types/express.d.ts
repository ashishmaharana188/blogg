declare global {
  namespace Express {
    interface Request {
      requestId: string;
      sessionId: string;
      user?: {
        user_id: string;
        username: string;
        displayName: string;
        email: string;
      };
    }
  }
}

export {};
