import type { Video } from './contracts.ts'

export interface TrackLabel { title: string; detail: string; fullTitle: string }

// Match whole labels only: a song containing “英语版” still keeps its own name.
const languageVersion = /^(?:中文|国语|普通话|粤语|日语|日文|英语|英文|韩语|韩文|俄语|法语|德语|西班牙语)(?:版|版本|配音版|翻唱版)?$/i
const audioVersion = /^(?:原版|原唱|翻唱|伴奏|纯伴奏|纯音乐|人声版|无人声版|无歌词版|歌词版|完整版|现场版|录音室版|重制版|高清版|音频版|MV|PV|instrumental|off[\s-]*vocal|on[\s-]*vocal|(?:japanese|english|chinese|korean|original|live|full|short|acoustic|instrumental)\s+(?:version|ver\.?))$/i
const placeholder = /^(?:p\s*\d+|part[\s._-]*\d+|\d+|第\s*\d+\s*[pP段集]|未命名|默认标题)$/i

/** Derive presentation without changing source titles or the bvid:cid identity. */
export function getTrackLabel(video: Video, cid: number): TrackLabel {
  const original = video.title.trim()
  const part = video.pages.find(page => page.cid === cid)?.title.trim() ?? ''
  const label = part.replace(/^[（(【\[]\s*|\s*[）)】\]]$/g, '').trim()
  const fallback = original || video.bvid
  if (!part || placeholder.test(label)) return { title: fallback, detail: '', fullTitle: fallback }
  if (original && part !== original && (languageVersion.test(label) || audioVersion.test(label))) {
    return { title: original, detail: label, fullTitle: `${original}（${label}）` }
  }
  return { title: part, detail: '', fullTitle: part }
}
