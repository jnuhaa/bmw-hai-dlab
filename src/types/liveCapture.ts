export type LiveCaptureSessionResponse = {
  sessionId: string;
  phonePath: string;
};

export type LiveCaptureItem = {
  id: string;
  imageUrl: string;
  createdAt: string;
};

export type LiveCapturePollResponse = {
  sessionId: string;
  captures: LiveCaptureItem[];
  nextCursor: number;
  totalCaptures: number;
};

export type LiveCaptureUploadResponse = {
  sessionId: string;
  capture: LiveCaptureItem;
};
