export type Request =
  | { type: "DELETE_ENTRY"; id: string }
  | { type: "DELETE_ALL" }
  | { type: "UNDO_LAST_ADD" };

export type Response =
  | { type: "MUTATION_RESULT"; ok: true }
  | { type: "MUTATION_RESULT"; ok: false; error: string };
