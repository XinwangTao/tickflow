package com.tickflow.mobile;

import android.util.Log;

import com.alibaba.mnnllm.android.llm.GenerateProgressListener;
import com.alibaba.mnnllm.android.llm.LlmSession;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.FileInputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;

/**
 * 端侧 MNN 大模型的最小 Capacitor 桥。
 * 模型投递方式与 ielts-android 一致：
 *   adb push <模型目录>/. /sdcard/Android/data/com.tickflow.mobile/files/models/mnn/<模型名>/
 * 首次使用拷贝到内部 filesDir（/sdcard 是 FUSE，mmap 权重不可靠），之后直接复用。
 */
@CapacitorPlugin(name = "LocalAi")
public class LocalAiPlugin extends Plugin {

    private static final String TAG = "TickFlowLocalAi";
    private static final int BUFFER = 8 * 1024 * 1024;

    private final Object lock = new Object();
    private LlmSession session;
    private String loadedModel;
    private volatile boolean canceled;

    static File modelsRoot(android.content.Context context) {
        return new File(context.getExternalFilesDir(null), "models/mnn");
    }

    static File internalDir(android.content.Context context, String model) {
        return new File(context.getFilesDir(), "models/mnn/" + model);
    }

    private static boolean isComplete(File dir) {
        File weight = new File(dir, "llm.mnn.weight");
        File net = new File(dir, "llm.mnn");
        return new File(dir, "config.json").isFile()
                && new File(dir, "llm_config.json").isFile()
                && net.isFile() && net.length() > 0
                && weight.isFile() && weight.length() > 0;
    }

    private List<String> listModels(File root) {
        List<String> names = new ArrayList<>();
        File[] children = root.listFiles();
        if (children == null) return names;
        for (File child : children) {
            if (child.isDirectory() && new File(child, "config.json").isFile()) {
                names.add(child.getName());
            }
        }
        java.util.Collections.sort(names);
        return names;
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        result.put("loaded", session != null && session.isLoaded());
        result.put("model", loadedModel);
        result.put("busy", session != null && session.isLoaded() && loadedModel != null && false);
        result.put("externalModels", new JSArray(listModels(modelsRoot(getContext()))));
        result.put("internalModels", new JSArray(listModels(new File(getContext().getFilesDir(), "models/mnn"))));
        call.resolve(result);
    }

    /** 有内部副本就用内部，否则从外部投递目录整目录复制（先写 .tmp，完整后改名）。 */
    private File ensureModel(String model) throws IOException {
        File target = internalDir(getContext(), model);
        if (isComplete(target)) return target;
        File src = new File(modelsRoot(getContext()), model);
        if (!new File(src, "config.json").isFile()) {
            throw new IOException("缺少本地模型 " + model + "，请先 adb push 到 " + src.getAbsolutePath() + "/");
        }
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        deleteRecursively(tmp);
        if (!tmp.mkdirs()) throw new IOException("无法创建模型目录 " + tmp.getAbsolutePath());
        File[] files = src.listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.isFile()) copyFile(file, new File(tmp, file.getName()));
            }
        }
        if (!isComplete(tmp)) throw new IOException("模型文件不完整：" + src.getAbsolutePath());
        deleteRecursively(target);
        if (!tmp.renameTo(target)) throw new IOException("模型目录改名失败：" + target.getAbsolutePath());
        return target;
    }

    private static void copyFile(File from, File to) throws IOException {
        try (InputStream in = new FileInputStream(from);
             FileOutputStream out = new FileOutputStream(to)) {
            byte[] buffer = new byte[BUFFER];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    private static void deleteRecursively(File file) {
        if (file == null || !file.exists()) return;
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    @PluginMethod
    public void load(PluginCall call) {
        final String model = call.getString("model", "qwen35-2b");
        new Thread(() -> {
            long started = System.currentTimeMillis();
            try {
                synchronized (lock) {
                    if (session != null && session.isLoaded() && model.equals(loadedModel)) {
                        JSObject result = new JSObject();
                        result.put("loaded", true);
                        result.put("model", model);
                        result.put("ms", 0);
                        call.resolve(result);
                        return;
                    }
                    File dir = ensureModel(model);
                    JSONObject config = new JSONObject(readText(new File(dir, "llm_config.json")));
                    config.put("max_new_tokens", call.getInt("maxTokens", 384));
                    config.put("thread_num", 6);
                    config.put("temperature", 0.2);
                    if (session != null) session.release();
                    session = null;
                    LlmSession next = new LlmSession();
                    boolean ok = next.load(new File(dir, "config.json").getAbsolutePath(), config.toString());
                    if (!ok) throw new IOException("本地模型 " + model + " 加载失败（native 返回 0），请检查模型完整性");
                    session = next;
                    loadedModel = model;
                    JSObject result = new JSObject();
                    result.put("loaded", true);
                    result.put("model", model);
                    result.put("ms", System.currentTimeMillis() - started);
                    call.resolve(result);
                }
            } catch (Exception error) {
                Log.e(TAG, "load failed", error);
                call.reject(String.valueOf(error.getMessage()), error);
            }
        }, "tickflow-local-ai-load").start();
    }

    private static String readText(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] data = new byte[(int) file.length()];
            int offset = 0;
            while (offset < data.length) {
                int read = in.read(data, offset, data.length - offset);
                if (read < 0) break;
                offset += read;
            }
            return new String(data, 0, offset, "UTF-8");
        }
    }

    @PluginMethod
    public void generate(PluginCall call) {
        final String prompt = call.getString("prompt");
        if (prompt == null || prompt.isEmpty()) {
            call.reject("缺少 prompt");
            return;
        }
        new Thread(() -> {
            long started = System.currentTimeMillis();
            try {
                LlmSession active;
                synchronized (lock) {
                    if (session == null || !session.isLoaded()) {
                        call.reject("本地模型未加载");
                        return;
                    }
                    active = session;
                }
                canceled = false;
                final StringBuilder text = new StringBuilder();
                HashMap<String, Object> stats = active.submit(prompt, progress -> {
                    if (progress != null) text.append(progress);
                    return canceled;
                });
                JSObject result = new JSObject();
                result.put("text", text.toString());
                result.put("ms", System.currentTimeMillis() - started);
                result.put("stats", new JSONObject(stringMap(stats)).toString());
                call.resolve(result);
            } catch (Exception error) {
                Log.e(TAG, "generate failed", error);
                call.reject(String.valueOf(error.getMessage()), error);
            }
        }, "tickflow-local-ai-gen").start();
    }

    private static java.util.Map<String, Object> stringMap(HashMap<String, Object> stats) {
        java.util.Map<String, Object> map = new java.util.LinkedHashMap<>();
        if (stats != null) map.putAll(stats);
        return map;
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        canceled = true;
        call.resolve();
    }

    @PluginMethod
    public void unload(PluginCall call) {
        synchronized (lock) {
            if (session != null) session.release();
            session = null;
            loadedModel = null;
        }
        call.resolve();
    }
}
