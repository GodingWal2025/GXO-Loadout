import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from prepare_box_dataset import prepare_boxes


class BoxExportTests(unittest.TestCase):
    def fixture(self, root):
        snapshot = root / 'snapshot'
        snapshot.mkdir()
        (snapshot / 'photo.jpg').write_bytes(b'preserved-test-photo')
        digest = hashlib.sha256(b'preserved-test-photo').hexdigest()
        (snapshot / 'photo_inventory.json').write_text(json.dumps([dict(sampleId='sample1',photoId='photo1',role='FRONT',status='readable',path='photo.jpg',sha256=digest,width=100,height=100)]))
        data = dict(info=dict(annotationType='boxes'),categories=[dict(id=1,name='bag_flap',supercategory='pallet')],
                    images=[dict(id=1,file_name='front.jpg',sample_id='sample1',photo_id='photo1',role='FRONT',sha256=digest,
                                 width=100,height=100,pallet_group_id='group1',review_status='reviewed',reviewer='A',review_reason='checked',visible_count=0)],annotations=[])
        annotation = root / 'labels.json'
        annotation.write_text(json.dumps(data))
        return snapshot, annotation, data

    def test_zero_count_round_trip_preserves_bytes_and_group(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); snapshot, annotation, data=self.fixture(root)
            self.assertEqual(prepare_boxes(annotation,snapshot,root/'out'),1)
            self.assertEqual((root/'out/front.jpg').read_bytes(), b'preserved-test-photo')
            self.assertEqual(json.loads((root/'out/_annotations.coco.json').read_text()),data)
            self.assertEqual(json.loads((root/'out/dataset-manifest.json').read_text())['split'],'unassigned')

    def test_changed_photo_and_unknown_role_fail_before_output(self):
        for mutation in ('hash','top','path','count'):
            with self.subTest(mutation=mutation), tempfile.TemporaryDirectory() as directory:
                root=Path(directory); snapshot, annotation, data=self.fixture(root)
                if mutation=='hash': (snapshot/'photo.jpg').write_bytes(b'changed')
                if mutation=='top': data['images'][0]['role']='TOP'
                if mutation=='path': data['images'][0]['file_name']='../escape.jpg'
                if mutation=='count': data['images'][0]['visible_count']=1
                annotation.write_text(json.dumps(data))
                with self.assertRaises(ValueError): prepare_boxes(annotation,snapshot,root/'out')
                self.assertFalse((root/'out').exists())


if __name__ == '__main__': unittest.main()
