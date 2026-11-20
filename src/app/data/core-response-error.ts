export class InvalidCoreResponseError extends Error {
  constructor() {
    super('CORE returned an unexpected response.');
    this.name = 'InvalidCoreResponseError';
  }
}
