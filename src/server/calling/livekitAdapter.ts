export interface CallingProviderConfig {
  provider: 'livekit' | 'webrtc_p2p';
  livekitConfigured: boolean;
  livekitUrl: string | null;
  iceServers: Array<{ urls: string | string[] }>;
  consentNotice: string;
}

export function getCallingConfig(): CallingProviderConfig {
  const livekitUrl = process.env.LIVEKIT_URL?.trim() || null;
  const livekitConfigured = Boolean(
    livekitUrl &&
      process.env.LIVEKIT_API_KEY?.trim() &&
      process.env.LIVEKIT_API_SECRET?.trim()
  );

  return {
    provider: livekitConfigured ? 'livekit' : 'webrtc_p2p',
    livekitConfigured,
    livekitUrl,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    consentNotice:
      'Calls are direct one-to-one sessions between assigned participants. Team Leads only view call metadata (participants, start time, duration, outcome); covert listening or recording is disabled.',
  };
}
