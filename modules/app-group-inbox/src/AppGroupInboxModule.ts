import { NativeModule, requireNativeModule } from "expo";

declare class AppGroupInboxModule extends NativeModule {
  listInboxJsonFiles(): Promise<string[]>;
  readInboxFile(fileName: string): Promise<string>;
  deleteInboxFile(fileName: string): Promise<void>;
  cleanupStaleTmpFiles(maxAgeMs: number): Promise<void>;
  getAppGroupId(): string;
}

export default requireNativeModule<AppGroupInboxModule>("AppGroupInbox");
