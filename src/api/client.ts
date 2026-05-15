import axios from "axios";

const apiClient = axios.create({
  timeout: 30000,
  headers: { "Content-Type": "application/json" },
});

export function setBaseUrl(url: string) {
  apiClient.defaults.baseURL = url;
}

export default apiClient;
