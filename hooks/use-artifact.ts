"use client";

import { useCallback, useMemo } from "react";
import useSWR from "swr";
import type { UIArtifact } from "@/components/chat/artifact";

// 这是当前“激活中的 Artifact 面板”默认状态。
// 这里存的是前端 UI 运行时状态，不是数据库里的 Document 记录。
// `documentId = "init"` 是一个哨兵值，表示当前还没有真正打开任何 Artifact。
export const initialArtifactData: UIArtifact = {
  documentId: "init",
  content: "",
  kind: "text",
  title: "",
  status: "idle",
  isVisible: false,
  boundingBox: {
    top: 0,
    left: 0,
    width: 0,
    height: 0,
  },
};

type Selector<T> = (state: UIArtifact) => T;

// useArtifactSelector 让消费方只订阅自己关心的字段。
// 底层仍然共享同一个 SWR key（"artifact"），但上层组件不必总拿完整对象。
export function useArtifactSelector<Selected>(selector: Selector<Selected>) {
  const { data: localArtifact } = useSWR<UIArtifact>("artifact", null, {
    fallbackData: initialArtifactData,
  });

  const selectedValue = useMemo(() => {
    if (!localArtifact) {
      return selector(initialArtifactData);
    }
    return selector(localArtifact);
  }, [localArtifact, selector]);

  return selectedValue;
}

export function useArtifact() {
  // 整个项目把“当前打开的 Artifact”放进一个全局 SWR key。
  // 这样主聊天面板、文档预览卡片、流式处理器等都能共享同一份状态。
  const { data: localArtifact, mutate: setLocalArtifact } = useSWR<UIArtifact>(
    "artifact",
    null,
    {
      fallbackData: initialArtifactData,
    }
  );

  const artifact = useMemo(() => {
    if (!localArtifact) {
      return initialArtifactData;
    }
    return localArtifact;
  }, [localArtifact]);

  const setArtifact = useCallback(
    (updaterFn: UIArtifact | ((currentArtifact: UIArtifact) => UIArtifact)) => {
      // 保持 setState 风格 API，这样调用方既可以直接覆盖，也可以基于当前值增量更新。
      setLocalArtifact((currentArtifact) => {
        const artifactToUpdate = currentArtifact || initialArtifactData;

        if (typeof updaterFn === "function") {
          return updaterFn(artifactToUpdate);
        }

        return updaterFn;
      });
    },
    [setLocalArtifact]
  );

  const { data: localArtifactMetadata, mutate: setLocalArtifactMetadata } =
    useSWR<any>(
      // metadata 与主 artifact 状态分开存，按 documentId 做二级命名空间。
      // 这样不同文档的运行时附加信息（例如 text suggestions、code outputs）
      // 不会互相串掉。
      () =>
        artifact.documentId ? `artifact-metadata-${artifact.documentId}` : null,
      null,
      {
        fallbackData: null,
      }
    );

  return useMemo(
    () => ({
      artifact,
      setArtifact,
      metadata: localArtifactMetadata,
      setMetadata: setLocalArtifactMetadata,
    }),
    // 对外统一暴露“当前 Artifact + metadata + 两套 setter”。
    [artifact, setArtifact, localArtifactMetadata, setLocalArtifactMetadata]
  );
}
