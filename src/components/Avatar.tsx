import { useState } from 'react';

interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  online?: boolean;
}

const SIZE_CLASSES = {
  xs: 'w-7 h-7 text-xs',
  sm: 'w-9 h-9 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-14 h-14 text-base',
};

function getInitials(name: string): string {
  const parts = (name || '?').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Avatar({ name, src, size = 'md', online }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div className="relative inline-flex shrink-0">
      {src && !imgFailed ? (
        <img
          src={src}
          alt={name}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`${SIZE_CLASSES[size]} rounded-lg object-cover border border-slate-200 bg-slate-100`}
        />
      ) : (
        <div
          aria-label={name}
          className={`${SIZE_CLASSES[size]} rounded-lg bg-slate-800 text-slate-100 font-display font-semibold flex items-center justify-center border border-slate-700`}
        >
          {getInitials(name)}
        </div>
      )}
      {online !== undefined && (
        <span
          title={online ? 'Online now' : 'Offline'}
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${
            online ? 'bg-emerald-600' : 'bg-slate-300'
          }`}
        />
      )}
    </div>
  );
}
