import { Album, Asset, getPermissionsAsync, requestPermissionsAsync } from 'expo-media-library';

import { DeviceAlbumPermissionError, saveToPhotoAlbum, PHOTO_ALBUM } from '../src/lib/deviceAlbum';

jest.mock('expo-media-library', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  Album: {
    get: jest.fn(),
    create: jest.fn(),
  },
  Asset: {
    create: jest.fn(),
  },
}));

const permissions = {
  get: getPermissionsAsync as jest.Mock,
  request: requestPermissionsAsync as jest.Mock,
  albumGet: Album.get as jest.Mock,
  albumCreate: Album.create as jest.Mock,
  assetCreate: Asset.create as jest.Mock,
};

describe('LasFotos album', () => {
  beforeEach(() => {
    permissions.get.mockReset();
    permissions.request.mockReset();
    permissions.albumGet.mockReset();
    permissions.albumCreate.mockReset();
    permissions.assetCreate.mockReset();
  });

  it('copies a resized photo into the LasFotos album', async () => {
    permissions.get.mockResolvedValue({ granted: true, canAskAgain: true });
    permissions.albumGet.mockResolvedValue(null);
    permissions.albumCreate.mockResolvedValue({ id: 'album' });
    await saveToPhotoAlbum('file://small.jpg');
    expect(permissions.albumCreate).toHaveBeenCalledWith(PHOTO_ALBUM, ['file://small.jpg'], false);
    expect(permissions.assetCreate).not.toHaveBeenCalled();
  });

  it('adds the photo to the album that already exists', async () => {
    const album = { id: 'album' };
    permissions.get.mockResolvedValue({ granted: true, canAskAgain: true });
    permissions.albumGet.mockResolvedValue(album);
    await saveToPhotoAlbum('file://small.jpg');
    expect(permissions.assetCreate).toHaveBeenCalledWith('file://small.jpg', album);
    expect(permissions.albumCreate).not.toHaveBeenCalled();
  });

  it('asks for photo storage and refuses to drop the photo when access is denied', async () => {
    permissions.get.mockResolvedValue({ granted: false, canAskAgain: true });
    permissions.request.mockResolvedValue({ granted: false, canAskAgain: true });
    await expect(saveToPhotoAlbum('file://small.jpg')).rejects.toBeInstanceOf(DeviceAlbumPermissionError);
    expect(permissions.albumCreate).not.toHaveBeenCalled();
  });
});
