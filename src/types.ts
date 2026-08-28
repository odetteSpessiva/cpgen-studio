export interface WorkspaceFile {
  path: string;
  name: string;
  language: string;
  value: string;
  isDirty: boolean;
}

export interface WorkspaceFilePayload {
  path: string;
  name: string;
  language: string;
  value: string;
}

export type SettingKey =
  | "fontSize"
  | "fontFamily"
  | "compilerPath"
  | "compilerArgs"
  | "clangdPath"
  | "pylspPath";

export type WorkspaceSlot = "generator" | "solution";

export type tabSlot = "settings" | "editor";

export type GeneratorMode = "files" | "visual";

export type LogLevel = "info" | "success" | "warn" | "error" | "cmd" | "dim";

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
}

export interface ConfigState {
  batches: number;
  startIndex: number;
  problemName: string;
  indexDelivery: "argv[1]" | "stdin";
}

export type FieldKind = "int" | "float" | "string" | "array" | "loop";
export type PrimitiveSpec =
  | Omit<IntNode, "id" | "varName">
  | Omit<FloatNode, "id" | "varName">
  | Omit<StringNode, "id" | "varName">;

export interface BaseNode {
  id: string;
  kind: FieldKind;
  varName?: string;
  children?: SchemaNode[];
  outputFormat?: string;
}

export interface IntNode extends BaseNode {
  kind: "int";
  min: string;
  max: string;
}

export interface FloatNode extends BaseNode {
  kind: "float";
  min: string;
  max: string;
  precision: string;
}

export interface StringNode extends BaseNode {
  kind: "string";
  length: string;
  charset: "lowercase" | "uppercase" | "alphanumeric" | "digits" | "custom";
  customCharset?: string;
}

export interface ArrayNode extends BaseNode {
  kind: "array";
  length: string;
  separator: "space" | "newline" | "comma";
  element: PrimitiveSpec;
}

export interface LoopNode extends BaseNode {
  kind: "loop";
  count: string;
  children: SchemaNode[];
}

export type SchemaNode =
  IntNode | FloatNode | StringNode | ArrayNode | LoopNode;
