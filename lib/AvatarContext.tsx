import React, { createContext, useContext, useMemo, useState, ReactNode } from 'react';
import { SequenceItem } from '../lib/labels';

interface AvatarState {
    signToPlay: string | null;
    letterToPlay: string | null;
    sequenceToPlay: SequenceItem[] | null;
    isAvatarLoaded: boolean;
    avatarLoadError: string | null;
    spokenText: string;
    setSignToPlay: (sign: string | null) => void;
    setLetterToPlay: (letter: string | null) => void;
    setSequenceToPlay: (seq: SequenceItem[] | null) => void;
    setIsAvatarLoaded: (loaded: boolean) => void;
    setAvatarLoadError: (error: string | null) => void;
    setSpokenText: (text: string) => void;
    clearAvatarSigning: () => void;
    registerClearHandler: (handler: () => void) => () => void;
}

const AvatarContext = createContext<AvatarState | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
    const [signToPlay, setSignToPlay] = useState<string | null>(null);
    const [letterToPlay, setLetterToPlay] = useState<string | null>(null);
    const [sequenceToPlay, setSequenceToPlay] = useState<SequenceItem[] | null>(null);
    const [isAvatarLoaded, setIsAvatarLoaded] = useState(false);
    const [avatarLoadError, setAvatarLoadError] = useState<string | null>(null);
    const [spokenText, setSpokenText] = useState('');
    const clearHandlersRef = React.useRef<Set<() => void>>(new Set());

    const registerClearHandler = React.useCallback((handler: () => void) => {
        clearHandlersRef.current.add(handler);
        return () => {
            clearHandlersRef.current.delete(handler);
        };
    }, []);

    const clearAvatarSigning = React.useCallback(() => {
        setSequenceToPlay(null);
        setSignToPlay(null);
        setLetterToPlay(null);
        setSpokenText('');
        clearHandlersRef.current.forEach(handler => {
            try { handler(); } catch (err) { console.warn('Clear handler error:', err); }
        });
    }, []);

    const value = useMemo(() => ({
        signToPlay, setSignToPlay,
        letterToPlay, setLetterToPlay,
        sequenceToPlay, setSequenceToPlay,
        isAvatarLoaded, setIsAvatarLoaded,
        avatarLoadError, setAvatarLoadError,
        spokenText, setSpokenText,
        clearAvatarSigning,
        registerClearHandler,
    }), [signToPlay, letterToPlay, sequenceToPlay, isAvatarLoaded, avatarLoadError, spokenText, clearAvatarSigning, registerClearHandler]);

    return (
        <AvatarContext.Provider value={value}>
            {children}
        </AvatarContext.Provider>
    );
}

export function useAvatarContext() {
    const context = useContext(AvatarContext);
    if (!context) {
        throw new Error('useAvatarContext must be used within an AvatarProvider');
    }
    return context;
}
