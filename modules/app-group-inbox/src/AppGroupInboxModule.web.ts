export default {
  async listInboxJsonFiles(): Promise<string[]> {
    return [];
  },
  async readInboxFile(): Promise<string> {
    throw new Error("App Group inbox is iOS-only");
  },
  async deleteInboxFile(): Promise<void> {},
  async cleanupStaleTmpFiles(): Promise<void> {},
  getAppGroupId(): string {
    return "group.com.playproject.videobookmarkdemo";
  },
};
