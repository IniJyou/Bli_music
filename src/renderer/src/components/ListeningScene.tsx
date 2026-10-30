import { memo, useId } from 'react'
import rain from '../assets/scenes/rain.svg?raw'
import orange from '../assets/scenes/orange.svg?raw'
import yellow from '../assets/scenes/yellow.svg?raw'

export type ScenePalette = 'blue' | 'orange' | 'yellow'
export const scenes = [
  { id: 'blue', name: '雨窗', number: '01', label: '雨窗场景', art: rain },
  { id: 'orange', name: '漂流', number: '02', label: '漂流场景', art: orange },
  { id: 'yellow', name: '日光', number: '03', label: '日光场景', art: yellow },
] as const

/** Static, project-owned SVG only. Never insert metadata or network content here. */
export const ListeningScene = memo(function ListeningScene({ palette }: { palette: ScenePalette }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  return <div className="atmosphere" aria-hidden="true">
    {scenes.map(scene => <div key={scene.id} className={`scene-layer ${palette === scene.id ? 'active' : ''}`} dangerouslySetInnerHTML={{ __html: scene.art }} />)}
    <svg className="paper-grain">
      <filter id={`grain-${id}`}><feTurbulence type="fractalNoise" baseFrequency=".73" numOctaves="3" stitchTiles="stitch" /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="100%" height="100%" filter={`url(#grain-${id})`} />
    </svg>
    <svg className="paper-grain paper-bloom">
      <filter id={`mottle-${id}`}><feTurbulence type="fractalNoise" baseFrequency=".009 .014" numOctaves="3" stitchTiles="stitch" seed="15" /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="100%" height="100%" filter={`url(#mottle-${id})`} />
    </svg>
  </div>
})
