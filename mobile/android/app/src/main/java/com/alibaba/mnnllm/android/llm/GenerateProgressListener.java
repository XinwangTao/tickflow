package com.alibaba.mnnllm.android.llm;

/**
 * libmnnllmapp.so 的回调接口。
 * 包名 / 接口名 / 方法名不能改：so 内部按这个全限定名反射查找。
 */
public interface GenerateProgressListener {
    /** 流式回调一个片段；返回 true 表示请求中断生成。生成结束时会回调 null。 */
    boolean onProgress(String progress);
}
