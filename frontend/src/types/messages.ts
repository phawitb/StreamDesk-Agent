export type AgentState =
  | "idle"
  | "launching"
  | "navigating"
  | "loading_player"
  | "playing"
  | "error";

export interface StatusMessage {
  type: "status";
  state: AgentState;
  message: string;
  url?: string;
  title?: string;
  timestamp: string;
}

export interface ChatMessage {
  type: "chat";
  role: "assistant" | "user";
  content: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
  recoverable: boolean;
}

export interface PlayRequest {
  type: "play_request";
  url?: string;
  query?: string;
}

export interface CommandMessage {
  type: "command";
  action: "stop" | "fullscreen" | "download";
}

export interface MediaControlMessage {
  type: "media_control";
  action: "pause" | "resume" | "seek_forward" | "seek_backward" | "seek_to" | "get_status";
  value?: number;
}

export interface MediaStatusMessage {
  type: "media_status";
  currentTime: number;
  duration: number;
  paused: boolean;
  volume: number;
}

export interface EpisodeInfo {
  index: number;
  text: string;
  active: boolean;
}

export interface EpisodeListMessage {
  type: "episode_list";
  episodes: EpisodeInfo[];
}

export interface SelectEpisodeMessage {
  type: "select_episode";
  index: number;
}

export interface RecommendedMovie {
  title: string;
  url: string;
  poster?: string;
  rating?: string;
  quality?: string;
  language?: string;
  genres?: string;
}

export interface MovieRecommendationMessage {
  type: "movie_recommendations";
  message: string;
  movies: RecommendedMovie[];
}

export type ClientMessage = PlayRequest | CommandMessage | MediaControlMessage | SelectEpisodeMessage;

export type ServerMessage = StatusMessage | ChatMessage | ErrorMessage | MediaStatusMessage | EpisodeListMessage | MovieRecommendationMessage;

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  state?: AgentState;
  recommendations?: RecommendedMovie[];
}
