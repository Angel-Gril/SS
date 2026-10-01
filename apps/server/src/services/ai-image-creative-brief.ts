import { z } from 'zod';

// Creative directions are user input, never verified product facts or credentials.
const unsafeText = /(?:https?|blob|data|file|ftp|javascript|ws|wss):|www\.|\b[a-z][a-z0-9+.-]*:\/\/|\b(?:api[_ -]?key|authorization|bearer)\b|\bsk-[A-Za-z0-9]/iu;
// eslint-disable-next-line no-control-regex
const controlText = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/u;
const direction = (maximum: number) => z.string().refine((value) => (
  value === value.trim() && Array.from(value).length <= maximum
  && !controlText.test(value) && !unsafeText.test(value)
  && !/^(?:rk-|xai-|gsk_|hf_|r8_|ghp_|github_pat_|AIza|AKIA|ASIA)/u.test(value)
));

export const aiImageCreativeBriefSchema = z.object({
  prompt: direction(300).refine((value) => value.length > 0),
  negativePrompt: direction(150).optional(),
}).strict();
export type AiImageCreativeBrief = z.infer<typeof aiImageCreativeBriefSchema>;
