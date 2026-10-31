import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { translate, type Lang, type Params } from './i18n.ts';

interface Ctx { lang: Lang; setLang: (l: Lang) => void; t: (key: string, params?: Params) => string }
const I18nContext = createContext<Ctx>({ lang: 'en', setLang: () => undefined, t: (k) => k });

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'en' || saved === 'mr') return saved;
  } catch { /* storage may be blocked */ }
  return navigator.language.toLowerCase().startsWith('mr') ? 'mr' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem('lang', l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang; document.title = translate(lang, 'app.title'); }, [lang]);
  const t = useCallback((key: string, params?: Params) => translate(lang, key, params), [lang]);
  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = (): Ctx => useContext(I18nContext);
