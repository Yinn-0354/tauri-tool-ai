import { create } from "zustand";

type VcsType = "svn" | "git";

interface BlameState {
  filePath: string;
  vcsType: VcsType;
  setFilePath: (path: string) => void;
  setVcsType: (vcs: VcsType) => void;
}

export const useBlameStore = create<BlameState>((set) => ({
  filePath: "",
  vcsType: "svn",
  setFilePath: (path) => set({ filePath: path }),
  setVcsType: (vcs) => set({ vcsType: vcs }),
}));
