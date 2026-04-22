import React, { createContext, useContext, useState, ReactNode } from 'react';
import { SequenceItem } from '../lib/labels';

interface AvatarState {
    signToPlay: string | null;
    letterToPlay: string | null;
    sequenceToPlay: SequenceItem[] | null;
    isAvatarLoaded: boolean;
    setSignToPlay: (sign: string | null) => void;
    setLetterToPlay: (letter: string | null) => void;
    setSequenceToPlay: (seq: SequenceItem[] | null) => void;
    setIsAvatarLoaded: (loaded: boolean) => void;
}

const AvatarContext = createContext<AvatarState | null>(null);

export function AvatarProvider({ children }: { children: ReactNode }) {
    const [signToPlay, setSignToPlay] = useState<string | null>(null);
    const [letterToPlay, setLetterToPlay] = useState<string | null>(null);
    const [sequenceToPlay, setSequenceToPlay] = useState<SequenceItem[] | null>(null);
    const [isAvatarLoaded, setIsAvatarLoaded] = useState(false);

    return (
        <AvatarContext.Provider value={{
            signToPlay, setSignToPlay,
            letterToPlay, setLetterToPlay,
            sequenceToPlay, setSequenceToPlay,
            isAvatarLoaded, setIsAvatarLoaded
        }}>
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
