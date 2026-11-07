package com.alibaba.mnnllm.android.llm;

import java.util.HashMap;
import java.util.List;

/**
 * MNN LLM 的最小 JNI 封装（对齐 ielts-android 的 LlmSession，Apache-2.0）。
 *
 * 包名、类名、方法名必须与 so 内静态注册符号完全一致：
 * Java_com_alibaba_mnnllm_android_llm_LlmSession_{initNative,submitNative,releaseNative}。
 * 改任何一项都会在 System.loadLibrary 后调用时崩溃。
 */
public class LlmSession {

    private long ptr = 0L;

    static {
        System.loadLibrary("mnnllmapp");
    }

    /**
     * 加载模型。
     *
     * @param configPath         模型目录下 config.json 的绝对路径（native 端据此定位同目录权重）
     * @param mergedConfigJson   llm_config.json 内容（可覆盖 max_new_tokens / backend 等）
     * @param extraConfigJson    运行参数：{"is_r1":false,"mmap_dir":"","keep_history":false}
     */
    public boolean load(String configPath, String mergedConfigJson, String extraConfigJson) {
        ptr = initNative(configPath, null, mergedConfigJson, extraConfigJson);
        return ptr != 0L;
    }

    /** 默认运行参数：不启用思考链、不保留会话历史、mmap 目录留空。 */
    public boolean load(String configPath, String mergedConfigJson) {
        return load(configPath, mergedConfigJson,
                "{\"is_r1\":false,\"mmap_dir\":\"\",\"keep_history\":false}");
    }

    /** 阻塞式生成：native 线程通过 listener 流式回调，全部结束后返回统计信息。 */
    public HashMap<String, Object> submit(String input, GenerateProgressListener listener) {
        if (ptr == 0L) throw new IllegalStateException("本地模型未加载");
        return submitNative(ptr, input, false, listener);
    }

    public void release() {
        if (ptr != 0L) {
            releaseNative(ptr);
            ptr = 0L;
        }
    }

    public boolean isLoaded() {
        return ptr != 0L;
    }

    private native long initNative(String configPath, List<String> history,
                                   String mergedConfigStr, String configJsonStr);

    private native HashMap<String, Object> submitNative(long instanceId, String input,
                                                        boolean keepHistory,
                                                        GenerateProgressListener listener);

    private native void releaseNative(long instanceId);
}
