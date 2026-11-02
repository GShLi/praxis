export interface Chat {
  id: string;
  owner: string;
  title: string;
  latest_seq: number;
  active_generation: string | null;
  archived: boolean;
}

export interface Generation {
  id: string;
  session_id: string;
  input_id: string;
  status: string;
  content: string;
  page_id: string;
  lease_hash: string;
}

export interface Running {
  id: string;
  chatId: string;
  owner: string;
  controller: AbortController;
  lease: string;
  pageId: string;
  heartbeat: number;
  disconnectedAt: number | null;
  content: string;
  done: Promise<void>;
}
