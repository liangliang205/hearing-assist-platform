#include "apo.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>

// {8D3F1A2B-5C4E-4F60-9B7A-1E2D3C4B5A69}
const GUID CLSID_HearLinkApo = {
    0x8D3F1A2B, 0x5C4E, 0x4F60, {0x9B, 0x7A, 0x1E, 0x2D, 0x3C, 0x4B, 0x5A, 0x69}};

// 微软 INF 示例里的 APOInterface0
const GUID IID_HearLinkApoInterface0 = {
    0xFD7F2B29, 0x24D0, 0x4B5C, {0xB1, 0x77, 0x59, 0x2C, 0x39, 0xF9, 0xCA, 0x10}};

static const wchar_t* kLogDir = L"C:\\ProgramData\\HearLink";
static const wchar_t* kLogPath = L"C:\\ProgramData\\HearLink\\apo.log";
static const wchar_t* kGainPath = L"C:\\ProgramData\\HearLink\\gain.txt";

void ApoLog(const char* message) {
    CreateDirectoryW(kLogDir, nullptr);

    // 音频引擎会并发调用，写日志必须串行，否则 CreateFile 会因共享冲突失败而丢行
    HANDLE mutex = CreateMutexW(nullptr, FALSE, L"Global\\HearLinkApoLog");
    if (mutex) WaitForSingleObject(mutex, 500);

    HANDLE file = CreateFileW(kLogPath, FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file != INVALID_HANDLE_VALUE) {
        SYSTEMTIME st;
        GetLocalTime(&st);

        char buffer[512];
        int length = sprintf_s(buffer, sizeof(buffer), "[%02d:%02d:%02d.%03d] %s\r\n", st.wHour,
                               st.wMinute, st.wSecond, st.wMilliseconds, message);
        if (length > 0) {
            DWORD written = 0;
            WriteFile(file, buffer, static_cast<DWORD>(length), &written, nullptr);
        }
        CloseHandle(file);
    }

    if (mutex) {
        ReleaseMutex(mutex);
        CloseHandle(mutex);
    }
}

// 从文件读增益（线性倍数），默认 +6 dB。只在 Initialize 里读，不在实时线程里碰 IO。
static float ReadConfiguredGain() {
    HANDLE file = CreateFileW(kGainPath, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE,
                              nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (file == INVALID_HANDLE_VALUE) return 2.0f;

    char buffer[64] = {0};
    DWORD read = 0;
    ReadFile(file, buffer, sizeof(buffer) - 1, &read, nullptr);
    CloseHandle(file);

    float value = static_cast<float>(atof(buffer));
    if (value < 0.05f || value > 8.0f) return 2.0f;  // 合理范围保护
    return value;
}

static CRegAPOProperties<1> g_RegProperties(CLSID_HearLinkApo, L"HearLink 最小验证 APO",
                                            L"HearLink", 1, 0, IID_HearLinkApoInterface0);

CHearLinkApo::CHearLinkApo(IUnknown* pUnkOuter)
    : CBaseAudioProcessingObject(g_RegProperties), m_lRefCount(1), m_gain(2.0f) {
    (void)pUnkOuter;
}

CHearLinkApo::~CHearLinkApo() = default;

STDMETHODIMP CHearLinkApo::QueryInterface(REFIID riid, void** ppvObject) {
    if (ppvObject == nullptr) return E_POINTER;
    *ppvObject = nullptr;

    const char* matched = nullptr;
    if (riid == IID_IUnknown) {
        *ppvObject = static_cast<IAudioProcessingObject*>(this);
        matched = "IUnknown";
    } else if (riid == __uuidof(IAudioProcessingObject)) {
        *ppvObject = static_cast<IAudioProcessingObject*>(this);
        matched = "IAudioProcessingObject";
    } else if (riid == __uuidof(IAudioProcessingObjectRT)) {
        *ppvObject = static_cast<IAudioProcessingObjectRT*>(this);
        matched = "IAudioProcessingObjectRT";
    } else if (riid == __uuidof(IAudioProcessingObjectConfiguration)) {
        *ppvObject = static_cast<IAudioProcessingObjectConfiguration*>(this);
        matched = "IAudioProcessingObjectConfiguration";
    } else if (riid == __uuidof(IAudioSystemEffects3)) {
        *ppvObject = static_cast<IAudioSystemEffects3*>(this);
        matched = "IAudioSystemEffects3";
    } else if (riid == __uuidof(IAudioSystemEffects2)) {
        *ppvObject = static_cast<IAudioSystemEffects2*>(this);
        matched = "IAudioSystemEffects2";
    } else if (riid == __uuidof(IAudioSystemEffects) || riid == IID_HearLinkApoInterface0) {
        *ppvObject = static_cast<IAudioSystemEffects*>(this);
        matched = "IAudioSystemEffects";
    }

    if (matched == nullptr) {
        OLECHAR text[64] = {0};
        StringFromGUID2(riid, text, 64);
        char narrow[80] = {0};
        WideCharToMultiByte(CP_ACP, 0, text, -1, narrow, sizeof(narrow), nullptr, nullptr);

        char message[160];
        sprintf_s(message, sizeof(message), "QueryInterface 未支持的 IID: %s", narrow);
        ApoLog(message);
        return E_NOINTERFACE;
    }

    AddRef();
    return S_OK;
}

STDMETHODIMP_(ULONG) CHearLinkApo::AddRef() {
    return static_cast<ULONG>(InterlockedIncrement(&m_lRefCount));
}

STDMETHODIMP_(ULONG) CHearLinkApo::Release() {
    ULONG count = static_cast<ULONG>(InterlockedDecrement(&m_lRefCount));
    if (count == 0) delete this;
    return count;
}

STDMETHODIMP CHearLinkApo::Initialize(UINT32 cbDataSize, BYTE* pbyData) {
    char message[160];
    sprintf_s(message, sizeof(message), "Initialize 进入 cbDataSize=%u", cbDataSize);
    ApoLog(message);

    HRESULT hr = CBaseAudioProcessingObject::Initialize(cbDataSize, pbyData);

    sprintf_s(message, sizeof(message), "Initialize 返回 hr=0x%08X", static_cast<unsigned>(hr));
    ApoLog(message);
    if (FAILED(hr)) return hr;

    m_gain = ReadConfiguredGain();

    sprintf_s(message, sizeof(message), "Initialize 成功，增益 %.2fx (%.1f dB)", m_gain,
              20.0f * std::log10(m_gain));
    ApoLog(message);

    return S_OK;
}

STDMETHODIMP CHearLinkApo::GetRegistrationProperties(APO_REG_PROPERTIES** ppRegProps) {
    ApoLog("调用 GetRegistrationProperties");
    HRESULT hr = CBaseAudioProcessingObject::GetRegistrationProperties(ppRegProps);
    char message[160];
    sprintf_s(message, sizeof(message), "GetRegistrationProperties hr=0x%08X",
              static_cast<unsigned>(hr));
    ApoLog(message);
    return hr;
}

STDMETHODIMP CHearLinkApo::GetLatency(HNSTIME* pTime) {
    ApoLog("调用 GetLatency");
    return CBaseAudioProcessingObject::GetLatency(pTime);
}

STDMETHODIMP CHearLinkApo::IsInputFormatSupported(IAudioMediaType* pOutputFormat,
                                                  IAudioMediaType* pRequestedInputFormat,
                                                  IAudioMediaType** ppSupportedInputFormat) {
    ApoLog("调用 IsInputFormatSupported");
    HRESULT hr = CBaseAudioProcessingObject::IsInputFormatSupported(
        pOutputFormat, pRequestedInputFormat, ppSupportedInputFormat);
    char message[160];
    sprintf_s(message, sizeof(message), "IsInputFormatSupported hr=0x%08X",
              static_cast<unsigned>(hr));
    ApoLog(message);
    return hr;
}

STDMETHODIMP CHearLinkApo::IsOutputFormatSupported(IAudioMediaType* pInputFormat,
                                                   IAudioMediaType* pRequestedOutputFormat,
                                                   IAudioMediaType** ppSupportedOutputFormat) {
    ApoLog("调用 IsOutputFormatSupported");
    HRESULT hr = CBaseAudioProcessingObject::IsOutputFormatSupported(
        pInputFormat, pRequestedOutputFormat, ppSupportedOutputFormat);
    char message[160];
    sprintf_s(message, sizeof(message), "IsOutputFormatSupported hr=0x%08X",
              static_cast<unsigned>(hr));
    ApoLog(message);
    return hr;
}

STDMETHODIMP CHearLinkApo::LockForProcess(UINT32 u32NumInputConnections,
                                          APO_CONNECTION_DESCRIPTOR** ppInputConnections,
                                          UINT32 u32NumOutputConnections,
                                          APO_CONNECTION_DESCRIPTOR** ppOutputConnections) {
    char message[160];
    sprintf_s(message, sizeof(message), "调用 LockForProcess in=%u out=%u", u32NumInputConnections,
              u32NumOutputConnections);
    ApoLog(message);

    HRESULT hr = CBaseAudioProcessingObject::LockForProcess(
        u32NumInputConnections, ppInputConnections, u32NumOutputConnections, ppOutputConnections);

    sprintf_s(message, sizeof(message), "LockForProcess hr=0x%08X", static_cast<unsigned>(hr));
    ApoLog(message);
    return hr;
}

STDMETHODIMP CHearLinkApo::UnlockForProcess(void) {
    ApoLog("调用 UnlockForProcess");
    return CBaseAudioProcessingObject::UnlockForProcess();
}

// Windows 11 引擎会查询 IAudioSystemEffects3。我们不做"可控制系统效果列表"，
// 返回空列表即可，效果本身仍然通过 APOProcess 生效。
STDMETHODIMP CHearLinkApo::GetEffectsList(LPGUID* ppEffectsIds, UINT* pcEffects, HANDLE event) {
    UNREFERENCED_PARAMETER(event);
    ApoLog("调用 GetEffectsList");
    if (ppEffectsIds == nullptr || pcEffects == nullptr) return E_POINTER;
    *ppEffectsIds = nullptr;
    *pcEffects = 0;
    return S_OK;
}

STDMETHODIMP CHearLinkApo::GetControllableSystemEffectsList(AUDIO_SYSTEMEFFECT** effects,
                                                            UINT* numEffects, HANDLE event) {
    UNREFERENCED_PARAMETER(event);
    ApoLog("调用 GetControllableSystemEffectsList");
    if (effects == nullptr || numEffects == nullptr) return E_POINTER;
    *effects = nullptr;
    *numEffects = 0;
    return S_OK;
}

STDMETHODIMP CHearLinkApo::SetAudioSystemEffectState(GUID effectId,
                                                      AUDIO_SYSTEMEFFECT_STATE state) {
    UNREFERENCED_PARAMETER(effectId);
    UNREFERENCED_PARAMETER(state);
    ApoLog("调用 SetAudioSystemEffectState");
    return E_NOTIMPL;
}

void CHearLinkApo::APOProcess(UINT32 u32NumInputConnections,
                              APO_CONNECTION_PROPERTY** ppInputConnections,
                              UINT32 u32NumOutputConnections,
                              APO_CONNECTION_PROPERTY** ppOutputConnections) {
    // 实时线程：不做任何 IO、不加锁、不分配内存（首次调用记一条日志便于排查）
    static volatile LONG s_processLogged = 0;
    if (InterlockedExchange(&s_processLogged, 1) == 0) {
        ApoLog("APOProcess 首次调用 —— DSP 已生效");
    }

    if (!m_bIsLocked) return;

    const UINT32 samplesPerFrame = GetSamplesPerFrame();
    const float gain = m_gain;

    for (UINT32 i = 0; i < u32NumOutputConnections && i < u32NumInputConnections; ++i) {
        APO_CONNECTION_PROPERTY* output = ppOutputConnections[i];
        APO_CONNECTION_PROPERTY* input = ppInputConnections[i];

        if (output == nullptr || input == nullptr) continue;
        if (input->pBuffer == 0) continue;

        const float* source = reinterpret_cast<const float*>(input->pBuffer);
        float* target = reinterpret_cast<float*>(output->pBuffer);
        const UINT32 frames = output->u32ValidFrameCount;
        const UINT32 samples = frames * samplesPerFrame;

        for (UINT32 s = 0; s < samples; ++s) {
            float value = source[s] * gain;
            if (value > 1.0f) value = 1.0f;
            else if (value < -1.0f) value = -1.0f;
            target[s] = value;
        }

        output->u32ValidFrameCount = frames;
        output->u32BufferFlags = input->u32BufferFlags;
    }
}
