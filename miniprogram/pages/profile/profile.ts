// profile.ts
import { Toast } from 'tdesign-miniprogram';

Page({
  data: {
    isLoggedIn: false,
    userInfo: {
      avatarUrl: '',
      nickName: '',
      openid: '',
    },
    creationCount: 0,
    myImages: [] as Array<{
      id: string;
      imageUrl: string;
      prompt: string;
      createTime: Date;
    }>,
  },

  onLoad() {
    this.checkLoginStatus();
  },

  onShow() {
    if (this.data.isLoggedIn) {
      this.loadUserImages();
    }
  },

  // 检查登录状态：调用 login 云函数获取 openid，再查 users 集合
  checkLoginStatus() {
    wx.cloud.callFunction({
      name: 'login',
      success: (res: any) => {
        if (res.result && res.result.openid) {
          this.getUserInfo(res.result.openid);
        } else {
          this.setData({ isLoggedIn: false });
        }
      },
      fail: (err: any) => {
        console.error('检查登录状态失败', err);
        this.setData({ isLoggedIn: false });
      }
    });
  },

  // 从 users 集合读取用户资料
  getUserInfo(openid: string) {
    const db = wx.cloud.database();
    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        if (res.data.length > 0) {
          const userInfo = res.data[0] as any;
          this.setData({
            isLoggedIn: true,
            userInfo: {
              avatarUrl: userInfo.avatarUrl,
              nickName: userInfo.nickName,
              openid: openid
            }
          });
          this.loadUserImages();
        } else {
          this.setData({ isLoggedIn: false });
        }
      },
      fail: (err: any) => {
        console.error('获取用户信息失败', err);
        const errMsg = (err as any).errMsg || '';
        if (errMsg.includes('not exist') || errMsg.includes('DATABASE_COLLECTION_NOT_EXIST')) {
          console.error('users 集合不存在，请在云开发控制台创建 users 集合');
        }
        this.setData({ isLoggedIn: false });
      }
    });
  },

  // 微信一键登录
  onLoginTap() {
    Toast({
      context: this,
      selector: '#t-toast',
      message: '登录中...',
      theme: 'loading',
      direction: 'column',
      duration: 0,
    });

    // 步骤1：调用 login 云函数获取 openid
    wx.cloud.callFunction({
      name: 'login',
      success: (loginRes: any) => {
        if (!loginRes.result || !loginRes.result.openid) {
          wx.hideToast();
          Toast({
            context: this,
            selector: '#t-toast',
            message: '获取用户身份失败',
            theme: 'error',
            direction: 'column',
          });
          return;
        }

        const openid = loginRes.result.openid;

        // 步骤2：尝试获取微信用户信息（getUserProfile 已废弃，降级处理）
        wx.getUserProfile({
          desc: '用于完善用户资料',
          success: (profileRes) => {
            const userInfo = profileRes.userInfo;
            this.saveUserInfo(openid, userInfo);
          },
          fail: () => {
            // getUserProfile 失败或被拒绝，使用默认头像和昵称静默登录
            const defaultUserInfo = {
              avatarUrl: '',
              nickName: '微信用户'
            };
            this.saveUserInfo(openid, defaultUserInfo);
          }
        });
      },
      fail: (err: any) => {
        console.error('云函数调用失败', err);
        wx.hideToast();
        const errMsg = (err as any).errMsg || '';
        let message = '登录失败，请重试';
        if (errMsg.includes('FUNCTIONS_NOT_FOUND') || errMsg.includes('not found')) {
          message = 'login 云函数未部署，请在开发者工具中右键 cloudfunctions/login 上传并部署';
        } else if (errMsg.includes('TIME_LIMIT')) {
          message = '云函数超时，请重新部署 login 云函数';
        }
        wx.showModal({
          title: '登录失败',
          content: message + '\n\n错误详情:\n' + errMsg,
          showCancel: false,
        });
      }
    });
  },

  // 保存用户信息到云数据库
  saveUserInfo(openid: string, userInfo: any) {
    const db = wx.cloud.database();

    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        if (res.data.length > 0) {
          // 用户已存在，更新信息
          db.collection('users').doc(res.data[0]._id).update({
            data: {
              avatarUrl: userInfo.avatarUrl,
              nickName: userInfo.nickName,
              updateTime: new Date()
            },
            success: () => {
              this.loginSuccess(openid, userInfo);
            },
            fail: (err: any) => {
              console.error('更新用户信息失败', err);
              wx.hideToast();
              this.showLoginError('更新用户信息失败: ' + ((err as any).errMsg || ''));
            }
          });
        } else {
          // 新用户，创建记录
          db.collection('users').add({
            data: {
              avatarUrl: userInfo.avatarUrl,
              nickName: userInfo.nickName,
              createTime: new Date(),
              updateTime: new Date()
            },
            success: () => {
              this.loginSuccess(openid, userInfo);
            },
            fail: (err: any) => {
              console.error('创建用户信息失败', err);
              wx.hideToast();
              const errMsg = (err as any).errMsg || '';
              let message = '登录失败，请重试';
              if (errMsg.includes('not exist') || errMsg.includes('DATABASE_COLLECTION_NOT_EXIST')) {
                message = 'users 集合不存在，请在云开发控制台创建 users 集合';
              } else {
                message = '创建用户信息失败: ' + errMsg;
              }
              this.showLoginError(message);
            }
          });
        }
      },
      fail: (err: any) => {
        console.error('查询用户信息失败', err);
        wx.hideToast();
        const errMsg = (err as any).errMsg || '';
        let message = '登录失败，请重试';
        if (errMsg.includes('not exist') || errMsg.includes('DATABASE_COLLECTION_NOT_EXIST')) {
          message = 'users 集合不存在，请在云开发控制台创建 users 集合';
        } else {
          message = '查询用户信息失败: ' + errMsg;
        }
        this.showLoginError(message);
      }
    });
  },

  showLoginError(message: string) {
    wx.showModal({
      title: '登录失败',
      content: message,
      showCancel: false,
    });
  },

  loginSuccess(openid: string, userInfo: any) {
    wx.hideToast();
    this.setData({
      isLoggedIn: true,
      userInfo: {
        avatarUrl: userInfo.avatarUrl,
        nickName: userInfo.nickName,
        openid: openid
      }
    });
    Toast({
      context: this,
      selector: '#t-toast',
      message: '登录成功',
      theme: 'success',
      direction: 'column',
    });
    this.loadUserImages();
  },

  loadUserImages() {
    const db = wx.cloud.database();
    db.collection('images').where({
      _openid: this.data.userInfo.openid
    }).orderBy('createTime', 'desc').get({
      success: async (res) => {
        const rawImages = res.data.map((item: any) => ({
          id: item._id,
          imageUrl: item.imageUrl as string,
          prompt: item.prompt,
          createTime: item.createTime
        }));

        // 批量转换 cloud:// fileID
        const fileIDList: string[] = [];
        for (const img of rawImages) {
          if (img.imageUrl && img.imageUrl.startsWith('cloud://')) {
            fileIDList.push(img.imageUrl);
          }
        }
        if (fileIDList.length > 0) {
          try {
            const tempRes = await wx.cloud.getTempFileURL({ fileList: fileIDList });
            const urlMap: Record<string, string> = {};
            for (const f of tempRes.fileList) {
              if (f.tempFileURL) {
                urlMap[f.fileID] = f.tempFileURL;
              }
            }
            for (const img of rawImages) {
              if (img.imageUrl in urlMap) {
                img.imageUrl = urlMap[img.imageUrl];
              }
            }
          } catch (e) {
            console.warn('转换临时URL失败:', e);
          }
        }

        this.setData({
          myImages: rawImages,
          creationCount: rawImages.length
        });
      },
      fail: (err) => {
        console.error('加载用户作品失败', err);
      }
    });
  },

  onCreateTap() {
    wx.navigateTo({
      url: '/pages/create/create'
    });
  },

  onLogoutTap() {
    this.setData({
      isLoggedIn: false,
      userInfo: {
        avatarUrl: '',
        nickName: '',
        openid: '',
      },
      myImages: [],
      creationCount: 0
    });
    Toast({
      context: this,
      selector: '#t-toast',
      message: '已退出登录',
      theme: 'success',
    });
  },

  onEditAvatarTap() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempFilePath = res.tempFiles[0].tempFilePath;
        this.uploadAvatar(tempFilePath);
      },
      fail: (err: any) => {
        if (err.errMsg !== 'chooseMedia:fail cancel') {
          console.error('选择图片失败', err);
        }
      }
    });
  },

  uploadAvatar(tempFilePath: string) {
    Toast({
      context: this,
      selector: '#t-toast',
      message: '上传中...',
      theme: 'loading',
      duration: 0,
    });

    const openid = this.data.userInfo.openid;
    const cloudPath = 'avatars/' + openid + '.jpg';

    wx.cloud.uploadFile({
      cloudPath: cloudPath,
      filePath: tempFilePath,
      success: (uploadRes) => {
        this.updateUserAvatar(uploadRes.fileID);
      },
      fail: (err) => {
        console.error('头像上传失败', err);
        wx.hideToast();
        Toast({
          context: this,
          selector: '#t-toast',
          message: '上传失败，请重试',
          theme: 'error',
        });
      }
    });
  },

  updateUserAvatar(fileID: string) {
    const db = wx.cloud.database();
    const openid = this.data.userInfo.openid;

    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        if (res.data.length > 0) {
          db.collection('users').doc(res.data[0]._id).update({
            data: {
              avatarUrl: fileID,
              updateTime: new Date()
            },
            success: () => {
              this.setData({ 'userInfo.avatarUrl': fileID });
              wx.hideToast();
              Toast({
                context: this,
                selector: '#t-toast',
                message: '头像更新成功',
                theme: 'success',
              });
            },
            fail: (err) => {
              console.error('更新头像信息失败', err);
              wx.hideToast();
              Toast({
                context: this,
                selector: '#t-toast',
                message: '更新失败，请重试',
                theme: 'error',
              });
            }
          });
        }
      },
      fail: (err) => {
        console.error('查询用户信息失败', err);
        wx.hideToast();
        Toast({
          context: this,
          selector: '#t-toast',
          message: '更新失败，请重试',
          theme: 'error',
        });
      }
    });
  },

  onEditNicknameTap() {
    wx.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '请输入新昵称',
      success: (res) => {
        if (res.confirm && res.content && res.content.trim()) {
          this.updateUserNickname(res.content.trim());
        }
      }
    });
  },

  updateUserNickname(newNickname: string) {
    Toast({
      context: this,
      selector: '#t-toast',
      message: '更新中...',
      theme: 'loading',
      duration: 0,
    });

    const db = wx.cloud.database();
    const openid = this.data.userInfo.openid;

    db.collection('users').where({
      _openid: openid
    }).get({
      success: (res) => {
        if (res.data.length > 0) {
          db.collection('users').doc(res.data[0]._id).update({
            data: {
              nickName: newNickname,
              updateTime: new Date()
            },
            success: () => {
              this.setData({ 'userInfo.nickName': newNickname });
              wx.hideToast();
              Toast({
                context: this,
                selector: '#t-toast',
                message: '昵称更新成功',
                theme: 'success',
              });
            },
            fail: (err) => {
              console.error('更新昵称失败', err);
              wx.hideToast();
              Toast({
                context: this,
                selector: '#t-toast',
                message: '更新失败，请重试',
                theme: 'error',
              });
            }
          });
        }
      },
      fail: (err) => {
        console.error('查询用户信息失败', err);
        wx.hideToast();
        Toast({
          context: this,
          selector: '#t-toast',
          message: '更新失败，请重试',
          theme: 'error',
        });
      }
    });
  }
});
