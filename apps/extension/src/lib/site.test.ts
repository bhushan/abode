import { describe, expect, it } from 'vitest';
import { hostOf, originPatternOf } from './site';

describe('originPatternOf', () => {
  it('narrows a page down to the one origin worth asking about', () => {
    expect(originPatternOf('https://www.hotstar.com/in/movies/x?y=1#z')).toBe('https://www.hotstar.com/*');
    expect(originPatternOf('http://localhost:5190/video.html')).toBe('http://localhost/*');
  });

  it('refuses schemes nobody can grant, rather than raising a dialog that fails', () => {
    expect(originPatternOf('chrome://extensions')).toBeNull();
    expect(originPatternOf('chrome-extension://abc/page.html')).toBeNull();
    expect(originPatternOf('file:///Users/x/clip.mp4')).toBeNull();
    expect(originPatternOf('about:blank')).toBeNull();
    expect(originPatternOf('not a url')).toBeNull();
    expect(originPatternOf('')).toBeNull();
  });
});

describe('hostOf', () => {
  it('is the part a person recognises', () => {
    expect(hostOf('https://www.crunchyroll.com/watch/GRDQ')).toBe('crunchyroll.com');
    expect(hostOf('https://hotstar.com/')).toBe('hotstar.com');
    expect(hostOf('nonsense')).toBe('');
  });
});
