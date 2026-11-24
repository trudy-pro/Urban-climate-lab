import { useEffect, useRef } from 'react';

/**
 * Soft generated city ambience for the map. Off until the visitor turns it on.
 */
export function useAmbience(on: boolean) {
  const ctx = useRef<{ ac: AudioContext; master: GainNode } | null>(null);

  useEffect(() => {
    if (!on) {
      const c = ctx.current;
      if (c) c.master.gain.setTargetAtTime(0, c.ac.currentTime, 0.4);
      return;
    }
    let c = ctx.current;
    if (!c) {
      const ac = new AudioContext();
      const noise = () => {
        const buf = ac.createBuffer(1, ac.sampleRate * 4, ac.sampleRate);
        const d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < d.length; i++) {
          const w = Math.random() * 2 - 1;
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        return src;
      };
      const master = ac.createGain();
      master.gain.value = 0;
      master.connect(ac.destination);

      // distant city: low, filtered rumble
      const hum = noise();
      const humFilter = ac.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 320;
      const humGain = ac.createGain();
      humGain.gain.value = 0.35;
      hum.connect(humFilter).connect(humGain).connect(master);
      hum.start();

      c = ctx.current = { ac, master };
    }
    void c.ac.resume();
    c.master.gain.setTargetAtTime(0.18, c.ac.currentTime, 0.6);
  }, [on]);

  useEffect(() => () => void ctx.current?.ac.close(), []);
}
