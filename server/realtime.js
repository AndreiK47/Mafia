let realtime;
function client() {
  if (process.env.REALTIME_PROVIDER !== 'ably' || !process.env.ABLY_API_KEY) return null;
  if (!realtime) {
    // Lazy import prevents requiring external credentials for local API unit tests.
    realtime = import('ably').then(({ default: Ably }) => new Ably.Rest({ key: process.env.ABLY_API_KEY }));
  }
  return realtime;
}

export async function publish(channel, name, data) {
  try {
    const ably = await client();
    if (!ably) return false;
    await ably.channels.get(channel).publish(name, data);
    return true;
  } catch (error) {
    console.error('realtime_publish_failed', { channel, name, message: error.message });
    return false;
  }
}

export async function createClientToken(userId, capability) {
  const ably = await client();
  if (!ably) throw new Error('Realtime provider is not configured.');
  return ably.auth.createTokenRequest({ clientId: userId, capability: JSON.stringify(capability), ttl: 60 * 1000 });
}
