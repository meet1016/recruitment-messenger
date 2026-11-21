import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff, ShieldCheck } from 'lucide-react';
import { apiRequest, realtimeClient } from '../lib/api';
import { Avatar } from './Avatar';
import { formatDuration } from '../lib/format';

export interface ActiveCallSession {
  callId: string;
  conversationId: string;
  peerUserId: string;
  peerName: string;
  peerAvatar?: string;
  callType: 'audio' | 'video';
  direction: 'outgoing' | 'incoming';
  offerSdp?: RTCSessionDescriptionInit;
}

interface CallModalProps {
  session: ActiveCallSession;
  onClose: () => void;
}

export function CallModal({ session, onClose }: CallModalProps) {
  const [phase, setPhase] = useState<'ringing' | 'connected' | 'ended'>('ringing');
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(session.callType === 'video');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [mediaNotice, setMediaNotice] = useState('');

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const cleanupMedia = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
  };

  const setupPeerConnection = async () => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    pcRef.current = pc;

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        realtimeClient.send({
          type: 'webrtc:ice',
          conversationId: session.conversationId,
          targetUserId: session.peerUserId,
          callId: session.callId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: session.callType === 'video',
        });
        localStreamRef.current = stream;
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } else {
        setMediaNotice('Browser media devices unavailable — signaling session active without local microphone/camera.');
      }
    } catch {
      setMediaNotice('Microphone or camera access was denied or unavailable. Call signaling remains active.');
    }

    return pc;
  };

  useEffect(() => {
    let active = true;

    const startOutgoing = async () => {
      const pc = await setupPeerConnection();
      if (!active) return;
      try {
        const offer = await pc.createOffer({
          offerToReceiveAudio: true,
          offerToReceiveVideo: session.callType === 'video',
        });
        await pc.setLocalDescription(offer);
        realtimeClient.send({
          type: 'call:invite',
          callId: session.callId,
          conversationId: session.conversationId,
          targetUserId: session.peerUserId,
          callType: session.callType,
          offer,
        });
      } catch {
        // Fallback signaling without SDP if browser restricts WebRTC in headless mode
        realtimeClient.send({
          type: 'call:invite',
          callId: session.callId,
          conversationId: session.conversationId,
          targetUserId: session.peerUserId,
          callType: session.callType,
        });
      }
    };

    if (session.direction === 'outgoing') {
      startOutgoing();
    }

    const unsubscribe = realtimeClient.subscribe(async (evt) => {
      if (evt.callId && evt.callId !== session.callId) return;

      if (evt.type === 'call:accept') {
        setPhase('connected');
        if (evt.answer && pcRef.current) {
          await pcRef.current.setRemoteDescription(new RTCSessionDescription(evt.answer)).catch(() => {});
        }
        startTimer();
      } else if (evt.type === 'webrtc:ice' && evt.candidate && pcRef.current) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(evt.candidate)).catch(() => {});
      } else if (evt.type === 'call:decline' || evt.type === 'call:end') {
        cleanupMedia();
        setPhase('ended');
        setTimeout(onClose, 500);
      }
    });

    return () => {
      active = false;
      unsubscribe();
      cleanupMedia();
    };
  }, [session.callId]);

  const startTimer = () => {
    if (timerRef.current) return;
    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSec(elapsedRef.current);
    }, 1000);
  };

  const handleAcceptIncoming = async () => {
    const pc = await setupPeerConnection();
    let answer: RTCSessionDescriptionInit | undefined;
    if (session.offerSdp) {
      await pc.setRemoteDescription(new RTCSessionDescription(session.offerSdp)).catch(() => {});
      answer = await pc.createAnswer().catch(() => undefined);
      if (answer) {
        await pc.setLocalDescription(answer).catch(() => {});
      }
    }

    realtimeClient.send({
      type: 'call:accept',
      callId: session.callId,
      conversationId: session.conversationId,
      targetUserId: session.peerUserId,
      answer,
    });

    await apiRequest(`/api/calls/${session.callId}`, {
      method: 'PATCH',
      body: { status: 'connected' },
    }).catch(() => {});

    setPhase('connected');
    startTimer();
  };

  const handleDecline = async () => {
    realtimeClient.send({
      type: 'call:decline',
      callId: session.callId,
      conversationId: session.conversationId,
      targetUserId: session.peerUserId,
    });
    await apiRequest(`/api/calls/${session.callId}`, {
      method: 'PATCH',
      body: { status: 'declined', outcome: 'Call declined' },
    }).catch(() => {});
    cleanupMedia();
    onClose();
  };

  const handleEndCall = async () => {
    const wasConnected = phase === 'connected';
    realtimeClient.send({
      type: 'call:end',
      callId: session.callId,
      conversationId: session.conversationId,
      targetUserId: session.peerUserId,
    });
    await apiRequest(`/api/calls/${session.callId}`, {
      method: 'PATCH',
      body: {
        status: wasConnected ? 'ended' : 'missed',
        durationSec: elapsedRef.current,
        outcome: wasConnected ? 'Completed call' : 'No answer — missed call recorded',
      },
    }).catch(() => {});
    cleanupMedia();
    onClose();
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !next;
    });
  };

  const toggleCamera = () => {
    const next = !cameraOn;
    setCameraOn(next);
    localStreamRef.current?.getVideoTracks().forEach((t) => {
      t.enabled = next;
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${session.callType === 'video' ? 'Video' : 'Audio'} call with ${session.peerName}`}
      className="fixed inset-0 z-50 bg-slate-950/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-xl bg-slate-900 text-white rounded-2xl border border-slate-700 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-display font-semibold">
              {session.callType === 'video' ? '1-to-1 Video Call' : '1-to-1 Audio Call'}
            </div>
            <div className="text-xs text-slate-400">
              {phase === 'ringing'
                ? session.direction === 'incoming'
                  ? `Incoming call from ${session.peerName}`
                  : `Calling ${session.peerName}...`
                : phase === 'connected'
                ? `Connected · ${formatDuration(elapsedSec)}`
                : 'Call ended'}
            </div>
          </div>
          <span className="font-mono text-xs text-slate-300 tabular-nums">
            {formatDuration(elapsedSec)}
          </span>
        </div>

        {/* Media Stage */}
        <div className="relative h-72 bg-slate-950 flex flex-col items-center justify-center p-6">
          {session.callType === 'video' ? (
            <>
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover rounded-xl bg-slate-900"
              />
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="absolute bottom-4 right-4 w-32 h-24 object-cover rounded-lg border border-slate-700 bg-slate-800"
              />
            </>
          ) : (
            <div className="flex flex-col items-center text-center">
              <Avatar name={session.peerName} src={session.peerAvatar} size="lg" />
              <div className="mt-4 font-display text-lg font-semibold text-white">{session.peerName}</div>
              <div className="mt-1 text-xs text-slate-400">
                {phase === 'connected' ? 'Encrypted WebRTC Audio Active' : 'Waiting for participant to connect...'}
              </div>
            </div>
          )}

          {mediaNotice && (
            <div className="absolute bottom-3 left-3 right-3 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-xs text-slate-300 text-center">
              {mediaNotice}
            </div>
          )}
        </div>

        {/* Consent & Non-Covert Notice */}
        <div className="px-6 py-2.5 bg-slate-800/70 border-t border-slate-800 flex items-center gap-2 text-xs text-slate-300">
          <ShieldCheck className="w-4 h-4 text-blue-400 shrink-0" />
          <span>Direct call — no covert listening or unauthorized recording. Metadata logged for history.</span>
        </div>

        {/* Call Controls */}
        <div className="px-6 py-5 flex items-center justify-center gap-4 bg-slate-900">
          {session.direction === 'incoming' && phase === 'ringing' ? (
            <>
              <button
                type="button"
                onClick={handleDecline}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                Decline
              </button>
              <button
                type="button"
                onClick={handleAcceptIncoming}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 cursor-pointer"
              >
                <Phone className="w-4 h-4" />
                Accept Call
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? 'Unmute microphone' : 'Mute microphone'}
                className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                  muted
                    ? 'bg-amber-600 border-amber-500 text-white'
                    : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                }`}
              >
                {muted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              {session.callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleCamera}
                  aria-label={cameraOn ? 'Turn camera off' : 'Turn camera on'}
                  className={`p-3 rounded-lg border transition-colors cursor-pointer ${
                    !cameraOn
                      ? 'bg-amber-600 border-amber-500 text-white'
                      : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700'
                  }`}
                >
                  {cameraOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
                </button>
              )}

              <button
                type="button"
                onClick={handleEndCall}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 cursor-pointer"
              >
                <PhoneOff className="w-4 h-4" />
                End Call
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
