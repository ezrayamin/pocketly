// ADR-0007: a late failure must never surface as an unhandled rejection.
const unhandled: unknown[] = [];
process.on('unhandledRejection', (reason) => unhandled.push(reason));
afterEach(() => {
  const found = unhandled.splice(0);
  if (found.length > 0) {
    throw new Error(`Unhandled promise rejection(s): ${found.map(String).join('; ')}`);
  }
});
