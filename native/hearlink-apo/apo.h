#pragma once

#include <windows.h>
#include <objbase.h>
#include <audioenginebaseapo.h>
#include <audioengineextensionapo.h>
#include <baseaudioprocessingobject.h>

// HearLink 最小验证 APO：对所有经过该输出端点的声音施加固定增益。
// 目的只有一个——证明「注册到端点后，系统里所有应用的声音都被处理」这条链路成立。

extern const GUID CLSID_HearLinkApo;

// 接口列表中声明的 APO 接口（微软 INF 示例中 APOInterface0 的同一个 GUID）。
extern const GUID IID_HearLinkApoInterface0;

void ApoLog(const char* message);

class CHearLinkApo : public CBaseAudioProcessingObject, public IAudioSystemEffects3 {
public:
    explicit CHearLinkApo(IUnknown* pUnkOuter);
    virtual ~CHearLinkApo();

    // IUnknown
    STDMETHODIMP QueryInterface(REFIID riid, void** ppvObject) override;
    STDMETHODIMP_(ULONG) AddRef() override;
    STDMETHODIMP_(ULONG) Release() override;

    // IAudioProcessingObject
    STDMETHODIMP Initialize(UINT32 cbDataSize, BYTE* pbyData) override;
    STDMETHODIMP GetRegistrationProperties(APO_REG_PROPERTIES** ppRegProps) override;
    STDMETHODIMP GetLatency(HNSTIME* pTime) override;
    STDMETHODIMP IsInputFormatSupported(IAudioMediaType* pOutputFormat,
                                        IAudioMediaType* pRequestedInputFormat,
                                        IAudioMediaType** ppSupportedInputFormat) override;
    STDMETHODIMP IsOutputFormatSupported(IAudioMediaType* pInputFormat,
                                         IAudioMediaType* pRequestedOutputFormat,
                                         IAudioMediaType** ppSupportedOutputFormat) override;

    // IAudioProcessingObjectConfiguration
    STDMETHODIMP LockForProcess(UINT32 u32NumInputConnections,
                                APO_CONNECTION_DESCRIPTOR** ppInputConnections,
                                UINT32 u32NumOutputConnections,
                                APO_CONNECTION_DESCRIPTOR** ppOutputConnections) override;
    STDMETHODIMP UnlockForProcess(void) override;

    // IAudioSystemEffects2
    STDMETHODIMP GetEffectsList(LPGUID* ppEffectsIds, UINT* pcEffects, HANDLE event) override;

    // IAudioSystemEffects3 —— Windows 11 音频引擎会主动查询这个接口
    STDMETHODIMP GetControllableSystemEffectsList(AUDIO_SYSTEMEFFECT** effects, UINT* numEffects,
                                                  HANDLE event) override;
    STDMETHODIMP SetAudioSystemEffectState(GUID effectId, AUDIO_SYSTEMEFFECT_STATE state) override;

    // IAudioProcessingObjectRT —— 真正的 DSP 入口
    STDMETHOD_(void, APOProcess)(
        UINT32 u32NumInputConnections,
        APO_CONNECTION_PROPERTY** ppInputConnections,
        UINT32 u32NumOutputConnections,
        APO_CONNECTION_PROPERTY** ppOutputConnections) override;

private:
    LONG m_lRefCount;
    float m_gain;
};
