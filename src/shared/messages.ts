export type Request =
  | { type: "CAPTURE_ACTIVE_TAB" }
  | { type: "DELETE_ENTRY"; id: string }
  | { type: "DELETE_ALL" }
  | { type: "UNDO_LAST_ADD" };

export type CaptureStatus = "added" | "duplicate" | "ineligible" | "error";

export type Response =
  | { type: "CAPTURE_RESULT"; status: CaptureStatus }
  | { type: "MUTATION_RESULT"; ok: true }
  | { type: "MUTATION_RESULT"; ok: false; error: string };
