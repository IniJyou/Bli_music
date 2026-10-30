type IconName = 'arrow' | 'link' | 'play' | 'pause' | 'previous' | 'next' | 'home' |
  'immersive' | 'volume' | 'muted' | 'refresh' | 'close' | 'info' | 'back' | 'music' | 'expand'

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    link: <><path d="m10 14 4-4M8 16l-1 1a4.2 4.2 0 0 1-6-6l4-4a4.2 4.2 0 0 1 6 0m2 0 1-1a4.2 4.2 0 0 1 6 6l-4 4a4.2 4.2 0 0 1-6 0" transform="translate(1 0)" /></>,
    play: <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="3.5" /></>,
    previous: <><path d="M6 5v14" /><path d="m18 5-10 7 10 7Z" fill="currentColor" stroke="none" /></>,
    next: <><path d="M18 5v14" /><path d="m6 5 10 7-10 7Z" fill="currentColor" stroke="none" /></>,
    home: <><path d="m3 10 9-7 9 7M6 9v11h12V9M10 20v-7h4v7" /></>,
    immersive: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M13 4v16M6 9h4M6 12h3M16 9h2M16 12h2" /></>,
    volume: <><path d="M4 9h4l5-4v14l-5-4H4ZM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    muted: <><path d="M4 9h4l5-4v14l-5-4H4ZM17 9l5 6m0-6-5 6" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M19 11a7 7 0 0 0-12-6L4 8m1 5a7 7 0 0 0 12 6l3-3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v.2" /></>,
    back: <path d="M19 12H5m6-6-6 6 6 6" />,
    music: <><path d="M10 17V5l9-2v12M10 8l9-2" /><ellipse cx="7" cy="18" rx="3" ry="2" /><ellipse cx="16" cy="16" rx="3" ry="2" /></>,
    expand: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}
