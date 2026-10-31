import { memo } from 'react'
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
  return <div className="atmosphere" aria-hidden="true">
    {scenes.map(scene => <div key={scene.id} className={`scene-layer ${palette === scene.id ? 'active' : ''}`} dangerouslySetInnerHTML={{ __html: scene.art }} />)}
    <div className="paper-grain" />
    <div className="paper-grain paper-bloom" />
  </div>
})
