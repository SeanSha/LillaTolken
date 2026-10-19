/** The Chinese sentence spoken (and shown) for confirmation: "你是说：……，对吗？" */
export const confirmationPrompt = (meaning: string): string =>
  `你是说：${meaning.trim().replace(/[。.!！?？，,\s]+$/u, '')}，对吗？`;
