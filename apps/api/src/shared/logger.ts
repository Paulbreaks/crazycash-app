export function logInfo(message: string, payload?: unknown) {
  if (payload) {
    console.log(message, payload);
    return;
  }
  console.log(message);
}
