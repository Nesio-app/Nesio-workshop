'use client';

import { IconMic } from '../icons';

/**
 * MeetingRecorderSheet — 会议记录 sheet:Web Speech 中文转写 + 手动输入,
 * 保存为会议纪要节点(addMeetingNotes)。从 FocusModeSheet 拆出。
 */

import { useEffect, useRef, useState } from 'react';
import { addMeetingNotes, type FocusNode, type MeetingExtraction } from '@/lib/platform/view-models/today-view-model';
import { L } from '@/lib/portal/i18n';
import { portalLocaleToDictionaryLocale } from '@/lib/portal/profile';
import { usePortalLocale } from '../use-portal-locale';
import { useSheetDismiss } from '@/lib/portal/use-sheet-dismiss';
import NesioSheet from '../ui/NesioSheet';
import { guardPaidCloudAi } from '@/lib/portal/entitlement';

type SpeechRecAPI = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

export function MeetingRecorderSheet({ open, meetingNode, onClose }: {
  open: boolean;
  meetingNode: FocusNode | null;
  onClose: () => void;
}) {
  const dict = portalLocaleToDictionaryLocale(usePortalLocale());
  const [recording, setRecording] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [saved, setSaved] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  // 批次 154:会议行动项抽取结果(To do / Inferred),保存后在完成页展示。
  const [extraction, setExtraction] = useState<MeetingExtraction | null>(null);
  const [seconds, setSeconds] = useState(0);
  // 可见失败纪律:不支持语音转写的浏览器不显示假录音波形,如实提示改用手动输入。
  const [speechSupported, setSpeechSupported] = useState(true);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecAPI | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const win = window as unknown as Record<string, unknown>;
    setSpeechSupported(Boolean(win.webkitSpeechRecognition || win.SpeechRecognition));
  }, []);

  useEffect(() => {
    if (!open) {
      setRecording(false);
      setTranscript('');
      setSaved(false);
      setAnalyzing(false);
      setExtraction(null);
      setSeconds(0);
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    }
    // 卸载时(未先置 open=false 就被父组件移除)也要停麦克风和计时器,否则麦克风一直亮着。
    return () => {
      if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
  }, [open]);

  function startRecording() {
    const win = window as unknown as Record<string, unknown>;
    const SpeechRec = (win.webkitSpeechRecognition || win.SpeechRecognition) as (new () => SpeechRecAPI) | undefined;
    // 不支持就不假装在录 —— 明确提示、只留手动输入,不显示会动的假波形。
    if (!SpeechRec) {
      setSpeechSupported(false);
      setSpeechError(L(dict, '这个浏览器不支持语音转写,请在下方直接输入会议笔记。', "This browser can't transcribe speech — type your notes below instead."));
      return;
    }
    setSpeechError(null);
    setRecording(true);
    setSeconds(0);
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    try {
      const rec = new SpeechRec();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = dict === 'en' ? 'en-US' : 'zh-CN';
      rec.onresult = (e) => {
        const text = Array.from(e.results).map((r) => r[0].transcript).join('');
        setTranscript(text);
      };
      rec.onerror = (e) => {
        // 麦克风被拒/识别报错:显式告知,别让用户对着空转写说半天。
        setSpeechError(
          e?.error === 'not-allowed'
            ? L(dict, '麦克风权限被拒,请在浏览器允许后重试,或直接输入。', 'Microphone blocked — allow it and retry, or type instead.')
            : L(dict, '语音转写出错,请重试或直接输入。', 'Speech transcription error — retry or type instead.'),
        );
        stopRecording();
      };
      rec.onend = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
      rec.start();
      recognitionRef.current = rec;
    } catch {
      setSpeechError(L(dict, '无法启动语音转写,请直接输入会议笔记。', "Couldn't start transcription — type your notes instead."));
      stopRecording();
    }
  }

  function stopRecording() {
    setRecording(false);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null; }
  }

  async function saveNotes() {
    const finalText = transcript.trim() || L(dict, '（无内容）', '(empty)');
    const nowStr = new Date().toLocaleString(dict === 'en' ? 'en-US' : 'zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const meetingName = meetingNode?.name || nowStr;

    // 批次 154:先让 AI 从转写里抽 To do / Inferred;抽到就分层入库(To do→今天页),
    // 抽不到/无 AI/出错则降级为只存转写原文(旧行为),不因抽取失败丢记录。
    setAnalyzing(true);
    let extracted: MeetingExtraction | null = null;
    // 安全审计 #2:AI 抽取是付费云,免费(分层启用后)→ 跳过抽取、只存转写原文(既有降级路径)+ 升级引导。
    if (transcript.trim() && guardPaidCloudAi('meeting_notes')) {
      try {
        const res = await fetch('/api/portal/meeting-notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ transcript: finalText, duration: formatTime(seconds), calendarEvent: meetingNode?.name || '' }),
        });
        const data = await res.json() as { ok?: boolean; summary?: string; todo?: MeetingExtraction['todo']; inferred?: string[]; people?: string[] };
        if (res.ok && data.ok && ((data.todo?.length ?? 0) > 0 || (data.inferred?.length ?? 0) > 0)) {
          extracted = { summary: data.summary, todo: data.todo, inferred: data.inferred, people: data.people };
        }
      } catch { /* 网络/解析失败 → 降级只存原文 */ }
    }

    addMeetingNotes(meetingNode?.id || '', meetingName, finalText, dict, extracted ?? undefined);
    setExtraction(extracted);
    setAnalyzing(false);
    setSaved(true);
    // 抽到行动项就多停一会儿让用户看清 To do;没抽到走原来的快关。
    setTimeout(() => onClose(), extracted && (extracted.todo?.length || extracted.inferred?.length) ? 4200 : 1800);
  }

  const formatTime = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;

  useSheetDismiss(open, onClose);

  if (!open) return null;

  return (
    <NesioSheet
      variant="bottom"
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      card={false}
      className="nesio-recorder-sheet"
      ariaLabel={L(dict, '会议记录', 'Meeting notes')}
    >

        {saved ? (
          <div className="nesio-recorder-saved">
            <span className="nesio-recorder-saved-icon">📝</span>
            <p className="nesio-recorder-saved-title">{L(dict, '会议记录已保存', 'Meeting notes saved')}</p>
            {extraction && (extraction.todo?.length || extraction.inferred?.length) ? (
              <div className="nesio-recorder-actions-result">
                {extraction.todo && extraction.todo.length > 0 && (
                  <div className="nesio-recorder-ai-group">
                    <p className="nesio-recorder-ai-label">{L(dict, '要做的事 · 已加入今天', 'To do · added to today')}</p>
                    <ul className="nesio-recorder-ai-list">
                      {extraction.todo.map((t, i) => (
                        <li key={i} className="nesio-recorder-ai-item">
                          <span className="nesio-recorder-ai-dot" aria-hidden />
                          <span className="nesio-recorder-ai-text">{t.text}</span>
                          {t.deadline && <span className="nesio-recorder-ai-due">{t.deadline}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {extraction.inferred && extraction.inferred.length > 0 && (
                  <div className="nesio-recorder-ai-group">
                    <p className="nesio-recorder-ai-label nesio-recorder-ai-label--muted">{L(dict, '可能还需要 · 推断', 'Might also need · inferred')}</p>
                    <ul className="nesio-recorder-ai-list">
                      {extraction.inferred.map((s, i) => (
                        <li key={i} className="nesio-recorder-ai-item nesio-recorder-ai-item--muted">
                          <span className="nesio-recorder-ai-dot nesio-recorder-ai-dot--muted" aria-hidden />
                          <span className="nesio-recorder-ai-text">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <p className="nesio-recorder-saved-hint">{L(dict, '已存入记忆，和会议条目关联', 'Saved to Memory, linked to the meeting entry')}</p>
            )}
          </div>
        ) : (
          <>
            <div className="nesio-recorder-header">
              <p className="nesio-recorder-title"><IconMic size={16} /> {L(dict, '会议记录', 'Meeting notes')}</p>
              {meetingNode && <p className="nesio-recorder-meeting-name">{meetingNode.name}</p>}
            </div>

            <div className="nesio-recorder-body">
              <div className="nesio-recorder-viz">
                {recording ? (
                  <>
                    <div className="nesio-recorder-wave">
                      {Array.from({ length: 20 }, (_, i) => (
                        <span key={i} className="nesio-recorder-wave-bar" style={{ animationDelay: `${i * 0.06}s` }} />
                      ))}
                    </div>
                    <span className="nesio-recorder-timer">{formatTime(seconds)}</span>
                  </>
                ) : (
                  <span className="nesio-recorder-mic-icon"><IconMic size={40} /></span>
                )}
              </div>

              {transcript ? (
                <div className="nesio-recorder-transcript">
                  <p className="nesio-recorder-transcript-label">{L(dict, '转写内容', 'Transcript')}</p>
                  <p className="nesio-recorder-transcript-text">{transcript}</p>
                </div>
              ) : (
                !recording && (
                  <p className="nesio-recorder-hint">
                    {speechSupported
                      ? L(dict, '点击录音，自动转写中文语音', 'Tap record — speech transcribes automatically')
                      : L(dict, '这个浏览器不支持语音转写,请直接输入笔记', "This browser can't transcribe — type notes below")}
                  </p>
                )
              )}
              {speechError && <p className="nesio-recorder-hint" style={{ color: 'var(--status-risk)' }}>{speechError}</p>}
            </div>

            <div className="nesio-recorder-actions">
              {recording ? (
                <button type="button" className="nesio-recorder-stop-btn" onClick={stopRecording}>{L(dict, '停止录音', 'Stop recording')}</button>
              ) : speechSupported ? (
                <button type="button" className="nesio-recorder-start-btn" onClick={startRecording}>{L(dict, '开始录音', 'Start recording')}</button>
              ) : null}

              {!recording && (
                <textarea
                  className="nesio-recorder-notes-input"
                  placeholder={L(dict, '或直接输入会议笔记…', 'Or type meeting notes directly…')}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  rows={3}
                />
              )}

              <button
                type="button"
                className={`nesio-recorder-save-btn${transcript.trim() && !analyzing ? ' nesio-recorder-save-btn--ready' : ''}`}
                onClick={saveNotes}
                disabled={recording || analyzing || !transcript.trim()}
              >
                {analyzing
                  ? L(dict, '正在提炼行动项…', 'Pulling out action items…')
                  : transcript.trim()
                    ? L(dict, '保存并提炼行动项', 'Save & extract action items')
                    : L(dict, '先录音或输入笔记', 'Record or type notes first')}
              </button>
            </div>
          </>
        )}
    </NesioSheet>
  );
}
