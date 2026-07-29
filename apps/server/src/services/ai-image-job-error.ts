export class AiImageJobError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiImageJobError';
  }
}
